import type { MotionPort } from 'motion-port'
import type { ServoMaintenancePort } from 'servo-maintenance'
import {
  type Maybe,
  type Pose,
  type Rotation as RotationType,
  randomBetween,
  type Vector3,
  writeBodyRelativeVector3,
  writeRotationFromVector3,
} from 'stackchan-util'
import Timer from 'timer'

const INTERVAL_POSE = 1000 / 10
const GAZE_THRESHOLD = Math.PI / 6

export type MotionDurationSeconds = number
export type ServoGoalTimeMilliseconds = number
export type ServoGoalTimeCentiseconds = number
export type MotionCompletion = (error?: unknown) => void
export type MotionResultCallback<T> = (result: T) => void

export type MotionDriver = {
  readonly maintenance?: ServoMaintenancePort
  readonly motion?: MotionPort
  applyRotation: (ori: RotationType, time?: MotionDurationSeconds, callback?: MotionCompletion) => void
  getRotation: (callback: MotionResultCallback<Maybe<RotationType>>) => void
  setTorque: (torque: boolean, callback?: MotionCompletion) => void
  onAttached?: () => void
  onDetached?: () => void
  close?: () => void
}

export type MotionControllerPose = {
  body: Pose
  eyes: {
    left: Pose
    right: Pose
  }
}

export type MotionControllerConstructorParam = {
  driver: MotionDriver
  pose?: MotionControllerPose
}

type MotionControllerOptions = {
  isPaused: () => boolean
}

type DriverCallbacks = {
  poll: () => void
  rotation: MotionResultCallback<Maybe<RotationType>>
  torqueEnabled: MotionCompletion
  motionApplied: MotionCompletion
  releaseTorque: () => void
  torqueReleased: MotionCompletion
}

export function motionDurationSecondsToMilliseconds(duration: MotionDurationSeconds): ServoGoalTimeMilliseconds {
  return Math.max(0, Math.round(duration * 1000))
}

export function motionDurationSecondsToCentiseconds(duration: MotionDurationSeconds): ServoGoalTimeCentiseconds {
  return Math.max(0, Math.round(duration * 100))
}

function createDefaultPose(): MotionControllerPose {
  return {
    body: {
      position: {
        x: 0.0,
        y: 0.0,
        z: 0.0,
      },
      rotation: {
        y: 0.0,
        p: 0.0,
        r: 0.0,
      },
    },
    eyes: {
      left: {
        position: {
          x: 0.03,
          y: 0.009,
          z: 0,
        },
        rotation: {
          r: 0.0,
          p: 0.0,
          y: 0.0,
        },
      },
      right: {
        position: {
          x: 0.03,
          y: -0.009,
          z: 0,
        },
        rotation: {
          r: 0.0,
          p: 0.0,
          y: 0.0,
        },
      },
    },
  }
}

export class MotionController {
  #driver: MotionDriver
  #attachedDriver: MotionDriver | undefined
  #callbacks: DriverCallbacks
  #generation = 0
  #switching = false
  #gazePoint: Vector3 | null = null
  #isMoving = false
  #nextRotation: RotationType = { y: 0, p: 0, r: 0 }
  #options: MotionControllerOptions
  #pendingMotionTime = 0
  #pose: MotionControllerPose
  #relativeGazePoint: Vector3 = [0, 0, 0]
  #relativeGazeRotation: RotationType = { y: 0, p: 0, r: 0 }
  #releaseTorqueHandler: ReturnType<typeof Timer.set> | undefined
  #updatePoseHandler: ReturnType<typeof Timer.repeat> | undefined
  #closed = false
  #commands = new Set<MotionCompletion>()
  updating = false

  constructor(params: MotionControllerConstructorParam, options: MotionControllerOptions) {
    this.#options = options
    this.#pose = params.pose ?? createDefaultPose()
    try {
      this.useDriver(params.driver)
    } catch (error) {
      // The host still owns the driver when attaching it fails.
      // Undo controller callbacks/timers before the host releases the device.
      try {
        this.close()
      } catch (cleanupError) {
        trace(`[MotionController] attach cleanup failed: ${String(cleanupError)}\n`)
      }
      throw error
    }
  }

  get driver(): MotionDriver {
    return this.#driver
  }

  get gazePoint(): Vector3 | null {
    return this.#gazePoint
  }

  get pose() {
    return this.#pose
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#generation += 1
    this.#gazePoint = null
    this.#isMoving = false
    this.updating = false
    this.#stopPosePolling()
    this.#clearReleaseTorqueTimer()
    let firstError: unknown
    let failed = false
    const attempt = (close: () => void) => {
      try {
        close()
      } catch (error) {
        if (!failed) {
          firstError = error
          failed = true
        }
      }
    }
    const driver = this.#attachedDriver
    this.#attachedDriver = undefined
    attempt(() => driver?.onDetached?.())
    for (const complete of this.#commands) attempt(() => complete(new Error('Motion controller is closed')))
    this.#commands.clear()
    if (failed) throw firstError
  }

  useDriver(driver: MotionDriver): void {
    this.#assertOpen()
    if (this.#attachedDriver === driver) return
    this.#switching = true
    this.#generation += 1
    this.#stopPosePolling()
    this.#clearReleaseTorqueTimer()
    this.#isMoving = false
    this.updating = false
    try {
      // Invalidate callbacks before detach: a driver may synchronously finish
      // old commands while releasing its resources.
      const previous = this.#attachedDriver
      this.#attachedDriver = undefined
      previous?.onDetached?.()
      for (const complete of [...this.#commands]) complete(new Error('Motion driver was replaced'))
      if (this.#closed) throw new Error('Motion controller is closed')
      this.#driver = driver
      this.#callbacks = this.#createCallbacks(this.#generation)
      this.#attachedDriver = driver
      driver.onAttached?.()
      if (this.#closed) throw new Error('Motion controller is closed')
      if (this.#gazePoint != null) this.#startPosePolling()
    } catch (error) {
      try {
        this.close()
      } catch (cleanupError) {
        trace(`[MotionController] replacement cleanup failed: ${String(cleanupError)}\n`)
      }
      throw error
    } finally {
      this.#switching = false
    }
  }

  lookAt(position?: Vector3 | null) {
    this.#assertOpen()
    if (position == null) {
      this.lookAway()
      return
    }
    this.#gazePoint = position
    this.#startPosePolling()
    this.updatePose()
  }

  lookAway() {
    this.#assertOpen()
    this.#gazePoint = null
    this.#stopPosePollingIfIdle()
  }

  setPose(pose: Pose, time?: number, callback?: MotionCompletion): void {
    this.#command((complete) => this.#driver.applyRotation(pose.rotation, time, complete), callback)
  }

  setTorque(torque: boolean, callback?: MotionCompletion): void {
    this.#command((complete) => this.#driver.setTorque(torque, complete), callback)
  }

  updatePose(_id?: unknown): void {
    if (this.#closed || this.#switching || this.updating || this.#options.isPaused()) {
      return
    }
    this.updating = true
    try {
      this.#driver.getRotation(this.#callbacks.rotation)
    } catch (error) {
      trace(`[MotionController] get rotation failed: ${String(error)}\n`)
      this.updating = false
    }
  }

  #handleRotation: MotionResultCallback<Maybe<RotationType>> = (result) => {
    if (this.#closed) return
    let waitingForMotion = false
    try {
      if (result.success) {
        const bodyRotation = this.#pose.body.rotation
        bodyRotation.y = result.value.y
        bodyRotation.p = result.value.p
        bodyRotation.r = result.value.r
      }

      const gazePoint = this.#gazePoint
      if (!this.#isMoving && gazePoint != null) {
        writeBodyRelativeVector3(this.#relativeGazePoint, gazePoint, this.#pose.body.rotation)
        writeRotationFromVector3(this.#relativeGazeRotation, this.#relativeGazePoint)
        const y = this.#relativeGazeRotation.y
        const p = this.#relativeGazeRotation.p
        if (y > GAZE_THRESHOLD || y < -GAZE_THRESHOLD || p > GAZE_THRESHOLD || p < -GAZE_THRESHOLD) {
          this.#isMoving = true
          waitingForMotion = true
          this.#pendingMotionTime = randomBetween(0.5, 1.0)
          writeRotationFromVector3(this.#nextRotation, gazePoint)
          try {
            this.#driver.setTorque(true, this.#callbacks.torqueEnabled)
          } catch (error) {
            trace(`[MotionController] set torque failed: ${String(error)}\n`)
            this.#isMoving = false
            waitingForMotion = false
          }
        }
      }
    } finally {
      if (!waitingForMotion) {
        this.updating = false
        this.#stopPosePollingIfIdle()
      }
    }
  }

  #handleTorqueEnabled: MotionCompletion = (torqueError) => {
    if (this.#closed) return
    if (torqueError) {
      trace(`[MotionController] set torque failed: ${String(torqueError)}\n`)
      this.#isMoving = false
      this.updating = false
      this.#stopPosePollingIfIdle()
      return
    }
    try {
      this.#driver.applyRotation(this.#nextRotation, this.#pendingMotionTime, this.#callbacks.motionApplied)
    } catch (error) {
      trace(`[MotionController] apply rotation failed: ${String(error)}\n`)
      this.#isMoving = false
      this.updating = false
      this.#stopPosePollingIfIdle()
    }
  }

  #handleMotionApplied: MotionCompletion = (moveError) => {
    if (this.#closed) return
    if (moveError) {
      trace(`[MotionController] apply rotation failed: ${String(moveError)}\n`)
      this.#isMoving = false
      this.#stopPosePollingIfIdle()
    } else {
      try {
        this.#clearReleaseTorqueTimer()
        this.#releaseTorqueHandler = Timer.set(this.#callbacks.releaseTorque, this.#pendingMotionTime * 1000 + 50)
      } catch (error) {
        trace(`[MotionController] release torque failed: ${String(error)}\n`)
        this.#isMoving = false
        this.#stopPosePollingIfIdle()
      }
    }
    this.updating = false
  }

  #releaseTorque = () => {
    if (this.#closed) return
    this.#releaseTorqueHandler = undefined
    try {
      this.#driver.setTorque(false, this.#callbacks.torqueReleased)
    } catch (error) {
      trace(`[MotionController] release torque failed: ${String(error)}\n`)
      this.#isMoving = false
      this.#stopPosePollingIfIdle()
    }
  }

  #handleTorqueReleased: MotionCompletion = (releaseError) => {
    if (this.#closed) return
    if (releaseError) {
      trace(`[MotionController] release torque failed: ${String(releaseError)}\n`)
    }
    this.#isMoving = false
    this.#stopPosePollingIfIdle()
  }

  #startPosePolling(): void {
    if (this.#closed || this.#updatePoseHandler) return
    this.#updatePoseHandler = Timer.repeat(this.#callbacks.poll, INTERVAL_POSE)
  }

  #stopPosePolling(): void {
    if (!this.#updatePoseHandler) return
    Timer.clear(this.#updatePoseHandler)
    this.#updatePoseHandler = undefined
  }

  #stopPosePollingIfIdle(): void {
    if (this.#gazePoint != null || this.#isMoving) return
    this.#stopPosePolling()
  }

  #clearReleaseTorqueTimer(): void {
    if (!this.#releaseTorqueHandler) return
    Timer.clear(this.#releaseTorqueHandler)
    this.#releaseTorqueHandler = undefined
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error('Motion controller is closed')
    if (this.#switching) throw new Error('Motion driver is being replaced')
  }

  #createCallbacks(generation: number): DriverCallbacks {
    // Allocate at driver binding, not on each polling frame. A closed or
    // replaced driver cannot advance a callback chain on the new device.
    const current = () => !this.#closed && !this.#switching && this.#generation === generation
    return {
      poll: () => {
        if (current()) this.updatePose()
      },
      rotation: (result) => {
        if (current()) this.#handleRotation(result)
      },
      torqueEnabled: (error) => {
        if (current()) this.#handleTorqueEnabled(error)
      },
      motionApplied: (error) => {
        if (current()) this.#handleMotionApplied(error)
      },
      releaseTorque: () => {
        if (current()) this.#releaseTorque()
      },
      torqueReleased: (error) => {
        if (current()) this.#handleTorqueReleased(error)
      },
    }
  }

  #command(start: (complete: MotionCompletion) => void, callback?: MotionCompletion): void {
    if (this.#closed || this.#switching) {
      const error = new Error(this.#closed ? 'Motion controller is closed' : 'Motion driver is being replaced')
      if (callback) callback(error)
      else throw error
      return
    }
    const generation = this.#generation
    const complete: MotionCompletion = (error) => {
      if (!this.#commands.delete(complete)) return
      callback?.(error)
    }
    this.#commands.add(complete)
    try {
      start((error) => {
        if (!this.#closed && !this.#switching && generation === this.#generation) complete(error)
      })
    } catch (error) {
      complete(error)
      if (!callback) throw error
    }
  }
}
