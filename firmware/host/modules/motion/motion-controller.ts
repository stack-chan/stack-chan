import { secondsToCentiseconds, secondsToMilliseconds } from 'domain-values'
import { GazeTrackingAggregate, type MotionControllerPose, MotionEffectKind, MotionPhase } from 'gaze-tracking-state'
import type { Maybe, Pose, Rotation as RotationType, Vector3 } from 'stackchan-util'
import Timer from 'timer'

const INTERVAL_POSE = 1000 / 10

export type MotionDurationSeconds = number
export type ServoGoalTimeMilliseconds = number
export type ServoGoalTimeCentiseconds = number
export type MotionCompletion = (error?: unknown) => void
export type MotionResultCallback<T> = (result: T) => void
export type { MotionControllerPose }
type WriteMotionPose = (pose: Pose, time: MotionDurationSeconds | undefined, callback: MotionCompletion) => void

export type MotionDriver = {
  applyRotation: (ori: RotationType, time?: MotionDurationSeconds, callback?: MotionCompletion) => void
  getRotation: (callback: MotionResultCallback<Maybe<RotationType>>) => void
  setTorque: (torque: boolean, callback?: MotionCompletion) => void
  onAttached?: () => void
  onDetached?: () => void
}

type TemporaryMotion = {
  driver: MotionDriver
  superseded: boolean
  releaseCallbacks?: MotionCompletion[]
}

export type MotionControllerConstructorParam = {
  driver: MotionDriver
  pose?: MotionControllerPose
}

type MotionControllerOptions = {
  isPaused: () => boolean
}

export function motionDurationSecondsToMilliseconds(duration: MotionDurationSeconds): ServoGoalTimeMilliseconds {
  return secondsToMilliseconds(duration)
}

export function motionDurationSecondsToCentiseconds(duration: MotionDurationSeconds): ServoGoalTimeCentiseconds {
  return secondsToCentiseconds(duration)
}

export class MotionController {
  // The constructor always initializes this through useDriver, including attachment.
  #driver!: MotionDriver
  #gaze: GazeTrackingAggregate
  #temporaryMotion: TemporaryMotion | undefined
  #torqueRequested = false
  #options: MotionControllerOptions
  #releaseTorqueAfterClose = false
  #releaseTorqueHandler: ReturnType<typeof Timer.set> | undefined
  #updatePoseHandler: ReturnType<typeof Timer.repeat> | undefined
  #updatePose = () => this.updatePose()
  updating = false

  constructor(params: MotionControllerConstructorParam, options: MotionControllerOptions) {
    this.#options = options
    this.#gaze = new GazeTrackingAggregate({ pose: params.pose })
    this.useDriver(params.driver)
  }

  get driver(): MotionDriver {
    return this.#driver
  }

  get gazePoint(): Vector3 | null {
    return this.#gaze.gazePoint
  }

  get pose(): MotionControllerPose {
    return this.#gaze.pose
  }

  close(): void {
    if (this.#temporaryMotion) this.#temporaryMotion.superseded = true
    const phase = this.#gaze.phase
    const inFlightTorqueOp = phase === MotionPhase.EnablingTorque || phase === MotionPhase.ApplyingRotation
    this.#releaseTorqueAfterClose = inFlightTorqueOp && !this.#torqueRequested
    this.#gaze.reset()
    this.updating = false
    this.#stopPosePolling()
    this.#clearReleaseTorqueTimer()
  }

  useDriver(driver: MotionDriver) {
    if (this.#driver != null) {
      if (this.#temporaryMotion) this.#temporaryMotion.superseded = true
      this.#driver.onDetached?.()
    }
    this.#releaseTorqueAfterClose = false
    this.#driver = driver
    this.#driver.onAttached?.()
  }

  lookAt(position?: Vector3 | null) {
    if (position == null) {
      this.lookAway()
      return
    }
    this.#gaze.setGazePoint(position)
    this.#startPosePolling()
    this.updatePose()
  }

  lookAway() {
    this.#gaze.setGazePoint(null)
    this.#stopPosePollingIfIdle()
  }

  setPose(pose: Pose, time?: number, callback?: MotionCompletion): void {
    if (this.#temporaryMotion) this.#temporaryMotion.superseded = true
    this.#driver.applyRotation(pose.rotation, time, callback)
  }

  setTorque(torque: boolean, callback?: MotionCompletion): void {
    this.#torqueRequested = torque
    const owner = this.#temporaryMotion
    if (owner?.driver === this.#driver && owner.releaseCallbacks) {
      if (callback) owner.releaseCallbacks.push(callback)
      return
    }
    this.#driver.setTorque(torque || owner?.driver === this.#driver, callback)
  }

  withTemporaryTorque(
    move: (setPose: WriteMotionPose, done: MotionCompletion) => void,
    callback: MotionCompletion,
  ): void {
    if (this.#temporaryMotion || this.#gaze.isMoving) {
      callback()
      return
    }
    const driver = this.#driver
    const owner: TemporaryMotion = { driver, superseded: false }
    this.#temporaryMotion = owner
    const finish: MotionCompletion = (motionError) => {
      if (owner.releaseCallbacks) return
      owner.superseded = true
      const callbacks: MotionCompletion[] = []
      owner.releaseCallbacks = callbacks
      let appliedTorque = true
      const restore: MotionCompletion = (releaseError) => {
        if (releaseError == null && driver === this.#driver && appliedTorque !== this.#torqueRequested) {
          appliedTorque = this.#torqueRequested
          try {
            driver.setTorque(appliedTorque, restore)
            return
          } catch (error) {
            releaseError = error
          }
        }
        if (this.#temporaryMotion !== owner) return
        this.#temporaryMotion = undefined
        callback(releaseError ?? motionError)
        for (const notify of callbacks) notify(releaseError)
      }
      restore()
    }
    const setPose: WriteMotionPose = (pose, time, done) => {
      if (owner.superseded) done()
      else driver.applyRotation(pose.rotation, time, done)
    }
    const begin: MotionCompletion = (error) => {
      if (error != null || owner.superseded) {
        finish(error)
        return
      }
      try {
        move(setPose, finish)
      } catch (moveError) {
        finish(moveError)
      }
    }
    try {
      if (this.#torqueRequested) begin()
      else driver.setTorque(true, begin)
    } catch (error) {
      finish(error)
    }
  }

  updatePose(_id?: unknown): void {
    if (this.updating || this.#options.isPaused()) {
      return
    }
    const effect = this.#gaze.requestPoll(false)
    if (effect.kind !== MotionEffectKind.ReadRotation) {
      return
    }
    this.updating = this.#gaze.isUpdating
    try {
      this.#driver.getRotation(this.#handleRotation)
    } catch (error) {
      trace(`[MotionController] get rotation failed: ${String(error)}\n`)
      const failureEffect = this.#gaze.onPoseReadError()
      this.updating = this.#gaze.isUpdating
      if (failureEffect.stopPolling) {
        this.#stopPosePolling()
      }
    }
  }

  #handleRotation: MotionResultCallback<Maybe<RotationType>> = (result) => {
    const effect = this.#gaze.onRotationSampled(result, this.#temporaryMotion !== undefined)
    if (effect.kind === MotionEffectKind.EnableTorque) {
      try {
        this.#driver.setTorque(effect.torque, this.#handleTorqueEnabled)
      } catch (error) {
        trace(`[MotionController] set torque failed: ${String(error)}\n`)
        const failureEffect = this.#gaze.onError()
        this.updating = this.#gaze.isUpdating
        if (failureEffect.stopPolling) {
          this.#stopPosePolling()
        }
      }
      return
    }
    this.updating = this.#gaze.isUpdating
    if (effect.stopPolling) {
      this.#stopPosePolling()
    }
  }

  #handleTorqueEnabled: MotionCompletion = (torqueError) => {
    if (this.#releaseTorqueAfterClose) {
      this.#releaseTorqueAfterClose = false
      if (!torqueError && !this.#torqueRequested) {
        try {
          this.#driver.setTorque(false, () => {})
        } catch (error) {
          trace(`[MotionController] release torque failed: ${String(error)}\n`)
        }
      }
      this.updating = this.#gaze.isUpdating
      return
    }
    if (torqueError) {
      trace(`[MotionController] set torque failed: ${String(torqueError)}\n`)
      const failureEffect = this.#gaze.onError()
      this.updating = this.#gaze.isUpdating
      if (failureEffect.stopPolling) {
        this.#stopPosePolling()
      }
      return
    }
    const effect = this.#gaze.onTorqueEnabled()
    if (effect.kind !== MotionEffectKind.ApplyRotation) {
      this.updating = this.#gaze.isUpdating
      if (effect.stopPolling) {
        this.#stopPosePolling()
      }
      return
    }
    try {
      this.#driver.applyRotation(effect.targetRotation, effect.durationSeconds, this.#handleMotionApplied)
    } catch (error) {
      trace(`[MotionController] apply rotation failed: ${String(error)}\n`)
      const failureEffect = this.#gaze.onError()
      this.updating = this.#gaze.isUpdating
      if (failureEffect.stopPolling) {
        this.#stopPosePolling()
      }
    }
  }

  #handleMotionApplied: MotionCompletion = (moveError) => {
    if (this.#releaseTorqueAfterClose) {
      this.#releaseTorqueAfterClose = false
      if (!this.#torqueRequested) {
        try {
          this.#driver.setTorque(false, () => {})
        } catch (error) {
          trace(`[MotionController] release torque failed: ${String(error)}\n`)
        }
      }
      this.updating = this.#gaze.isUpdating
      return
    }
    if (moveError) {
      trace(`[MotionController] apply rotation failed: ${String(moveError)}\n`)
      const failureEffect = this.#gaze.onError()
      this.updating = this.#gaze.isUpdating
      if (failureEffect.stopPolling) {
        this.#stopPosePolling()
      }
      return
    }
    const effect = this.#gaze.onMotionApplied()
    if (effect.kind === MotionEffectKind.ScheduleTorqueRelease) {
      try {
        this.#clearReleaseTorqueTimer()
        this.#releaseTorqueHandler = Timer.set(this.#releaseTorque, effect.settleDelayMs)
      } catch (error) {
        trace(`[MotionController] release torque failed: ${String(error)}\n`)
        const failureEffect = this.#gaze.onError()
        if (failureEffect.stopPolling) {
          this.#stopPosePolling()
        }
      }
    }
    this.updating = this.#gaze.isUpdating
  }

  #releaseTorque = () => {
    this.#releaseTorqueHandler = undefined
    const effect = this.#gaze.onSettleElapsed(this.#torqueRequested)
    if (effect.kind !== MotionEffectKind.ReleaseTorque) {
      if (effect.stopPolling) {
        this.#stopPosePolling()
      }
      return
    }
    try {
      this.#driver.setTorque(effect.torque, this.#handleTorqueReleased)
    } catch (error) {
      trace(`[MotionController] release torque failed: ${String(error)}\n`)
      const failureEffect = this.#gaze.onError()
      this.updating = this.#gaze.isUpdating
      if (failureEffect.stopPolling) {
        this.#stopPosePolling()
      }
    }
  }

  #handleTorqueReleased: MotionCompletion = (releaseError) => {
    if (releaseError) {
      trace(`[MotionController] release torque failed: ${String(releaseError)}\n`)
    }
    const effect = this.#gaze.onTorqueReleased()
    this.updating = this.#gaze.isUpdating
    if (effect.stopPolling) {
      this.#stopPosePolling()
    }
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
    if (!this.#gaze.shouldStopPolling) return
    this.#stopPosePolling()
  }

  #clearReleaseTorqueTimer(): void {
    if (!this.#releaseTorqueHandler) return
    Timer.clear(this.#releaseTorqueHandler)
    this.#releaseTorqueHandler = undefined
  }
}
