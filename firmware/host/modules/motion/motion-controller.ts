import {
  type Maybe,
  type Pose,
  type Rotation as RotationType,
  randomBetween,
  type Vector3,
  writeBodyRelativeVector3,
  writeRotationFromVector3,
} from 'stackchan-util'
import Time from 'time'
import Timer from 'timer'

const INTERVAL_POSE = 1000 / 10
const GAZE_THRESHOLD = Math.PI / 6
const MAX_CONTINUOUS_YAW_TIMEOUT_MS = 1000

export type MotionDurationSeconds = number
export type ServoGoalTimeMilliseconds = number
export type ServoGoalTimeCentiseconds = number
export type MotionCompletion = (error?: unknown) => void
export type MotionResultCallback<T> = (result: T) => void
export type MotionValueCompletion<T> = (error?: unknown, value?: T) => void

export type ContinuousYawControl = {
  setPower(power: number, timeoutMs: number, complete: MotionCompletion): void
  readRawPosition(complete: MotionValueCompletion<number>): void
  close(complete: MotionCompletion): void
}

export type ContinuousYawDriver = {
  start(complete: MotionCompletion): void
  setPower(power: number, complete: MotionCompletion): void
  readRawPosition(complete: MotionValueCompletion<number>): void
  stop(complete: MotionCompletion): void
}

export type MotionDriver = {
  applyRotation: (ori: RotationType, time?: MotionDurationSeconds, callback?: MotionCompletion) => void
  getRotation: (callback: MotionResultCallback<Maybe<RotationType>>) => void
  setTorque: (torque: boolean, callback?: MotionCompletion) => void
  prepareRotation?: (callback: MotionCompletion) => void
  continuousYaw?: ContinuousYawDriver
  onAttached?: () => void
  onDetached?: () => void
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

type ActiveContinuousYaw = {
  driver: ContinuousYawDriver
  expire: () => void
  busy: boolean
  deadline?: { started: number; timeoutMs: number; timer: ReturnType<typeof Timer.set> }
  closing?: MotionCompletion[]
  closed?: { error?: unknown }
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
  // The constructor always initializes this through useDriver, including attachment.
  #driver!: MotionDriver
  #continuousYaw?: ActiveContinuousYaw
  #closed = false
  #gazePoint: Vector3 | null = null
  #isMoving = false
  #nextRotation: RotationType = { y: 0, p: 0, r: 0 }
  #options: MotionControllerOptions
  #pendingMotionTime = 0
  #pose: MotionControllerPose
  #positionOperations = 0
  #positionIdle?: () => void
  #relativeGazePoint: Vector3 = [0, 0, 0]
  #relativeGazeRotation: RotationType = { y: 0, p: 0, r: 0 }
  #releaseTorqueHandler: ReturnType<typeof Timer.set> | undefined
  #updatePoseHandler: ReturnType<typeof Timer.repeat> | undefined
  #updatePose = () => this.updatePose()
  updating = false

  constructor(params: MotionControllerConstructorParam, options: MotionControllerOptions) {
    this.#options = options
    this.#pose = params.pose ?? createDefaultPose()
    this.useDriver(params.driver)
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

  get supportsContinuousYaw(): boolean {
    return this.#driver.continuousYaw !== undefined
  }

  close(complete?: MotionCompletion): void {
    this.#closed = true
    this.#stopPosePolling()
    this.#clearReleaseTorqueTimer()
    if (this.#continuousYaw) this.#closeContinuousYaw(this.#continuousYaw, complete)
    else complete?.()
  }

  useDriver(driver: MotionDriver) {
    if (this.#continuousYaw) throw new Error('Continuous yaw owns motion')
    if (this.#driver != null) {
      this.#driver.onDetached?.()
    }
    this.#driver = driver
    this.#driver.onAttached?.()
  }

  lookAt(position?: Vector3 | null) {
    if (this.#continuousYaw) return
    if (position == null) {
      this.lookAway()
      return
    }
    this.#gazePoint = position
    this.#startPosePolling()
    this.updatePose()
  }

  lookAway() {
    this.#gazePoint = null
    this.#stopPosePollingIfIdle()
  }

  setPose(pose: Pose, time?: number, callback?: MotionCompletion): void {
    if (this.#continuousYaw) {
      callback?.(new Error('Continuous yaw owns motion'))
      return
    }
    this.#positionOperation((done) => this.#driver.applyRotation(pose.rotation, time, done), callback)
  }

  setTorque(torque: boolean, callback?: MotionCompletion): void {
    if (this.#continuousYaw) {
      callback?.(new Error('Continuous yaw owns motion'))
      return
    }
    this.#positionOperation((done) => this.#driver.setTorque(torque, done), callback)
  }

  startContinuousYaw(complete: MotionValueCompletion<ContinuousYawControl>): void {
    const driver = this.#driver.continuousYaw
    if (!driver) {
      complete()
      return
    }
    if (this.#closed || this.#continuousYaw) {
      complete(new Error(this.#closed ? 'Motion is closed' : 'Continuous yaw owns motion'))
      return
    }

    const yaw: ActiveContinuousYaw = { driver, expire: () => this.#expireYaw(yaw), busy: true }
    const releaseGazeTorque = this.#isMoving
    this.#continuousYaw = yaw
    this.#gazePoint = null
    this.#isMoving = false
    this.#stopPosePolling()
    this.#clearReleaseTorqueTimer()

    const open = () => {
      this.#runYawOperation<void>(
        yaw,
        (done) => {
          const start = () => {
            if (yaw.closing) {
              done(new Error('Continuous yaw is closed'))
              return
            }
            try {
              driver.start(done)
            } catch (error) {
              done(error)
            }
          }
          if (releaseGazeTorque) {
            this.#driver.setTorque(false, (error) => {
              if (error != null) done(error)
              else Timer.set(start, 0)
            })
          } else start()
        },
        (error) => {
          if (error != null) return complete(error)
          try {
            this.#renewYawDeadline(yaw, MAX_CONTINUOUS_YAW_TIMEOUT_MS)
          } catch (timerError) {
            this.#closeContinuousYaw(yaw, (stopError) => complete(stopError ?? timerError))
            return
          }
          complete(undefined, {
            setPower: (power, timeoutMs, done) => this.#setYawPower(yaw, power, timeoutMs, done),
            readRawPosition: (done) => {
              const rejection = this.#yawCommandRejection(yaw)
              if (rejection) return done(rejection)
              this.#runYawOperation(
                yaw,
                (read) => {
                  const unavailable = this.#yawAvailabilityError(yaw)
                  if (unavailable) read(unavailable)
                  else driver.readRawPosition(read)
                },
                done,
              )
            },
            close: (done) => this.#closeContinuousYaw(yaw, done),
          })
        },
      )
    }
    if (this.#positionOperations) this.#positionIdle = open
    else open()
  }

  #setYawPower(yaw: ActiveContinuousYaw, power: number, timeoutMs: number, complete: MotionCompletion): void {
    const started = Time.ticks
    const rejection = this.#yawCommandRejection(yaw)
    if (rejection) {
      complete(rejection)
      return
    }
    if (
      !Number.isFinite(power) ||
      Math.abs(power) > 1 ||
      !Number.isInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > MAX_CONTINUOUS_YAW_TIMEOUT_MS
    ) {
      this.#closeContinuousYaw(yaw, (stopError) => {
        complete(stopError ?? new RangeError('Expected yaw power in [-1, 1] and a timeout of 1–1000 ms'))
      })
      return
    }
    try {
      this.#renewYawDeadline(yaw, timeoutMs, started)
    } catch (error) {
      this.#closeContinuousYaw(yaw, (stopError) => complete(stopError ?? error))
      return
    }
    this.#runYawOperation<void>(
      yaw,
      (done) => {
        const unavailable = this.#yawAvailabilityError(yaw)
        if (unavailable) done(unavailable)
        else yaw.driver.setPower(power, done)
      },
      complete,
    )
  }

  #runYawOperation<T>(
    yaw: ActiveContinuousYaw,
    run: (complete: MotionValueCompletion<T>) => void,
    complete: MotionValueCompletion<T>,
  ): void {
    yaw.busy = true
    let finished = false
    const done: MotionValueCompletion<T> = (error, value) => {
      if (finished) return
      finished = true
      yaw.busy = false
      const rejection = error ?? this.#yawAvailabilityError(yaw)
      if (rejection != null) this.#closeContinuousYaw(yaw, (stopError) => complete(stopError ?? rejection))
      else complete(undefined, value)
    }
    const dispatch = () => {
      try {
        run(done)
      } catch (error) {
        if (finished) throw error
        done(error)
      }
    }
    // UART dispatch uses a fresh XS stack even when the MOD's call stack is deep.
    try {
      Timer.set(dispatch, 0)
    } catch (error) {
      done(error)
    }
  }

  #yawCommandRejection(yaw: ActiveContinuousYaw): Error | undefined {
    const error = this.#yawAvailabilityError(yaw)
    if (error) {
      if (!yaw.closing && !yaw.closed) this.#expireYaw(yaw)
      return error
    }
    if (yaw.busy) return new Error('A continuous yaw operation is already pending')
  }

  #yawAvailabilityError(yaw: ActiveContinuousYaw): Error | undefined {
    if (yaw.closing || yaw.closed) return new Error('Continuous yaw is closed')
    const deadline = yaw.deadline
    if (deadline && Time.delta(deadline.started, Time.ticks) >= deadline.timeoutMs) {
      return new Error('Continuous yaw command expired')
    }
  }

  #renewYawDeadline(yaw: ActiveContinuousYaw, timeoutMs: number, started = Time.ticks): void {
    const remaining = timeoutMs - Time.delta(started, Time.ticks)
    if (remaining <= 0) throw new Error('Continuous yaw command expired')
    if (yaw.deadline) {
      yaw.deadline.started = started
      yaw.deadline.timeoutMs = timeoutMs
      Timer.schedule(yaw.deadline.timer, remaining)
      return
    }
    yaw.deadline = {
      started,
      timeoutMs,
      timer: Timer.set(yaw.expire, remaining),
    }
  }

  #expireYaw(yaw: ActiveContinuousYaw): void {
    this.#closeContinuousYaw(yaw, (error) => {
      if (error != null) trace(`[MotionController] continuous yaw stop failed: ${String(error)}\n`)
    })
  }

  #closeContinuousYaw(yaw: ActiveContinuousYaw, complete?: MotionCompletion): void {
    if (yaw.closed) {
      complete?.(yaw.closed.error)
      return
    }
    if (!yaw.closing) {
      yaw.closing = []
      if (yaw.deadline) Timer.clear(yaw.deadline.timer)
      yaw.deadline = undefined
    }
    if (complete) yaw.closing.push(complete)
    if (yaw.busy) return
    yaw.busy = true
    const stopped: MotionCompletion = (error) => {
      if (yaw.closed) return
      const callbacks = yaw.closing ?? []
      yaw.closing = undefined
      yaw.closed = { error }
      this.#continuousYaw = undefined
      if (error != null && !callbacks.length) trace(`[MotionController] continuous yaw stop failed: ${String(error)}\n`)
      for (const callback of callbacks) {
        try {
          callback(error)
        } catch (callbackError) {
          trace(`[MotionController] continuous yaw close callback failed: ${String(callbackError)}\n`)
        }
      }
    }
    try {
      yaw.driver.stop(stopped)
    } catch (error) {
      if (!yaw.closed) stopped(error)
    }
  }

  #positionOperation<T>(start: (callback?: (result: T) => void) => void, callback?: (result: T) => void): void {
    if (!this.#driver.continuousYaw) {
      start(callback)
      return
    }
    this.#positionOperations += 1
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      this.#finishPositionOperation()
    }
    try {
      start((result) => {
        try {
          callback?.(result)
        } finally {
          finish()
        }
      })
    } catch (error) {
      finish()
      throw error
    }
  }

  #finishPositionOperation(): void {
    this.#positionOperations -= 1
    if (!this.#positionOperations && this.#positionIdle) {
      const idle = this.#positionIdle
      this.#positionIdle = undefined
      idle()
    }
  }

  updatePose(_id?: unknown): void {
    if (this.#continuousYaw || this.updating || this.#options.isPaused()) {
      return
    }
    this.updating = true
    this.#positionOperations += 1
    try {
      this.#driver.getRotation(this.#handleRotation)
    } catch (error) {
      trace(`[MotionController] get rotation failed: ${String(error)}\n`)
      this.#finishPoseUpdate()
    }
  }

  #handleRotation: MotionResultCallback<Maybe<RotationType>> = (result) => {
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
            if (this.#driver.prepareRotation) this.#driver.prepareRotation(this.#handleTorqueEnabled)
            else this.#driver.setTorque(true, this.#handleTorqueEnabled)
          } catch (error) {
            trace(`[MotionController] set torque failed: ${String(error)}\n`)
            this.#isMoving = false
            waitingForMotion = false
          }
        }
      }
    } finally {
      if (!waitingForMotion) {
        this.#finishPoseUpdate()
        this.#stopPosePollingIfIdle()
      }
    }
  }

  #handleTorqueEnabled: MotionCompletion = (torqueError) => {
    if (this.#continuousYaw) {
      this.#finishPoseUpdate()
      return
    }
    if (torqueError) {
      trace(`[MotionController] set torque failed: ${String(torqueError)}\n`)
      this.#isMoving = false
      this.#finishPoseUpdate()
      this.#stopPosePollingIfIdle()
      return
    }
    try {
      this.#driver.applyRotation(this.#nextRotation, this.#pendingMotionTime, this.#handleMotionApplied)
    } catch (error) {
      trace(`[MotionController] apply rotation failed: ${String(error)}\n`)
      this.#isMoving = false
      this.#finishPoseUpdate()
      this.#stopPosePollingIfIdle()
    }
  }

  #handleMotionApplied: MotionCompletion = (moveError) => {
    if (this.#continuousYaw) {
      this.#finishPoseUpdate()
      return
    }
    if (moveError) {
      trace(`[MotionController] apply rotation failed: ${String(moveError)}\n`)
      this.#isMoving = false
      this.#stopPosePollingIfIdle()
    } else {
      try {
        this.#clearReleaseTorqueTimer()
        this.#releaseTorqueHandler = Timer.set(this.#releaseTorque, this.#pendingMotionTime * 1000 + 50)
      } catch (error) {
        trace(`[MotionController] release torque failed: ${String(error)}\n`)
        this.#isMoving = false
        this.#stopPosePollingIfIdle()
      }
    }
    this.#finishPoseUpdate()
  }

  #releaseTorque = () => {
    this.#releaseTorqueHandler = undefined
    if (this.#continuousYaw) return
    this.#positionOperations += 1
    try {
      this.#driver.setTorque(false, this.#handleTorqueReleased)
    } catch (error) {
      trace(`[MotionController] release torque failed: ${String(error)}\n`)
      this.#isMoving = false
      this.#stopPosePollingIfIdle()
      this.#finishPositionOperation()
    }
  }

  #handleTorqueReleased: MotionCompletion = (releaseError) => {
    if (releaseError) {
      trace(`[MotionController] release torque failed: ${String(releaseError)}\n`)
    }
    this.#isMoving = false
    this.#stopPosePollingIfIdle()
    this.#finishPositionOperation()
  }

  #finishPoseUpdate(): void {
    if (!this.updating) return
    this.updating = false
    this.#finishPositionOperation()
  }

  #startPosePolling(): void {
    if (this.#updatePoseHandler) return
    this.#updatePoseHandler = Timer.repeat(this.#updatePose, INTERVAL_POSE)
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
}
