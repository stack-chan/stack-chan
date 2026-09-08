import {
  type MotionCompletion,
  type MotionDurationSeconds,
  type MotionResultCallback,
  motionDurationSecondsToCentiseconds,
} from 'motion-driver'
import { reasonFromError } from 'motion-driver-callback'
import { directMotionPort, motionInfo } from 'motion-port'
import RS30X from 'protocols/rs30x'
import { ServoDriverResources } from 'servo-driver-resources'
import { createServoMaintenance } from 'servo-maintenance'
import type { Maybe, Rotation } from 'stackchan-util'

type RS30XDriverProps = {
  panId: number
  tiltId: number
}

export class RS30XDriver {
  get maintenance() {
    return createServoMaintenance('rs30x', this._pan, this._tilt)
  }
  readonly motion = directMotionPort(this, motionInfo('measured', [-150, 150], [-10, 25]))
  #resources = new ServoDriverResources()
  _pan: RS30X
  _tilt: RS30X
  #rotation: Rotation = { y: 0, p: 0, r: 0 }
  #rotationResult: Maybe<Rotation> = { success: true, value: this.#rotation }
  #rotationErrorResult: { success: false; reason?: string } = { success: false }

  constructor(param: RS30XDriverProps) {
    try {
      this._pan = this.#resources.own(new RS30X({ id: param.panId }))
      this._tilt = this.#resources.own(new RS30X({ id: param.tiltId }))
    } catch (error) {
      this.#resources.rollback(error)
    }
  }

  close(): void {
    this.#resources.close()
  }

  setTorque(torque: boolean, callback?: MotionCompletion): void {
    this._pan.setTorque(torque, (panError) => {
      if (panError != null) {
        callback?.(panError)
        return
      }
      this._tilt.setTorque(torque, callback)
    })
  }

  applyRotation(ori: Rotation, time: MotionDurationSeconds = 0.5, callback?: MotionCompletion): void {
    const panAngle = -(ori.y * 180) / Math.PI
    const tiltAngle = Math.min(Math.max((-ori.p * 180) / Math.PI, -25), 10)
    trace(`applying (${ori.y}, ${ori.p}) => (${panAngle}, ${tiltAngle})\n`)
    if (time === 0) {
      this._pan.setAngle(panAngle, (panError) => {
        if (panError != null) {
          callback?.(panError)
          return
        }
        this._tilt.setAngle(tiltAngle, callback)
      })
    } else {
      const goalTimeCentiseconds = motionDurationSecondsToCentiseconds(time)
      this._pan.setAngleInTime(panAngle, goalTimeCentiseconds, (panError) => {
        if (panError != null) {
          callback?.(panError)
          return
        }
        this._tilt.setAngleInTime(tiltAngle, goalTimeCentiseconds, callback)
      })
    }
  }

  getRotation(callback: MotionResultCallback<Maybe<Rotation>>): void {
    this._pan.readStatus((yawAngle, yawError) => {
      if (yawAngle == null) {
        this.#returnRotationError(callback, yawError == null ? 'response corrupted.' : reasonFromError(yawError))
        return
      }
      this._tilt.readStatus((tiltAngle, tiltError) => {
        if (tiltAngle == null) {
          this.#returnRotationError(callback, tiltError == null ? 'response corrupted.' : reasonFromError(tiltError))
          return
        }
        this.#rotation.y = (-Math.PI * yawAngle) / 180
        this.#rotation.p = (-Math.PI * tiltAngle) / 180
        this.#rotation.r = 0.0
        callback(this.#rotationResult)
      })
    })
  }

  #returnRotationError(callback: MotionResultCallback<Maybe<Rotation>>, reason?: string): void {
    this.#rotationErrorResult.reason = reason
    callback(this.#rotationErrorResult)
  }
}
