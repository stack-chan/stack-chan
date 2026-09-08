import {
  type MotionCompletion,
  type MotionDurationSeconds,
  type MotionResultCallback,
  motionDurationSecondsToMilliseconds,
} from 'motion-controller'
import { directMotionPort, motionInfo } from 'motion-port'
import SCServo from 'protocols/scservo'
import { ServoDriverResources } from 'servo-driver-resources'
import { createServoMaintenance } from 'servo-maintenance'
import type { Maybe, Rotation } from 'stackchan-util'

type SCServoDriverProps = {
  panId: number
  tiltId: number
}

export class SCServoDriver {
  get maintenance() {
    return createServoMaintenance('scservo', this._pan, this._tilt)
  }
  readonly motion = directMotionPort(this, motionInfo('measured', [-100, 100], [-25, 10]))
  #resources = new ServoDriverResources()
  _pan: SCServo
  _tilt: SCServo
  #rotation: Rotation = { y: 0, p: 0, r: 0 }
  #rotationResult: Maybe<Rotation> = { success: true, value: this.#rotation }
  #rotationErrorResult: { success: false; reason?: string } = { success: false }

  constructor(param: SCServoDriverProps) {
    try {
      this._pan = this.#resources.own(new SCServo({ id: param.panId }))
      this._tilt = this.#resources.own(new SCServo({ id: param.tiltId }))
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
    const panAngle = 100 - (ori.y * 180) / Math.PI
    const tiltAngle = 100 - Math.min(Math.max((ori.p * 180) / Math.PI, -25), 10)
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
      const goalTimeMilliseconds = motionDurationSecondsToMilliseconds(time)
      this._pan.setAngleInTime(panAngle, goalTimeMilliseconds, (panError) => {
        if (panError != null) {
          callback?.(panError)
          return
        }
        this._tilt.setAngleInTime(tiltAngle, goalTimeMilliseconds, callback)
      })
    }
  }
  getRotation(callback: MotionResultCallback<Maybe<Rotation>>): void {
    this._pan.readStatus((panStatus) => {
      if (panStatus.success === false) {
        this.#returnRotationError(callback, panStatus.reason)
        return
      }
      this._tilt.readStatus((tiltStatus) => {
        if (tiltStatus.success === false) {
          this.#returnRotationError(callback, tiltStatus.reason)
          return
        }
        this.#rotation.y = (-Math.PI * (panStatus.value.angle - 100)) / 180
        this.#rotation.p = (-Math.PI * (tiltStatus.value.angle - 100)) / 180
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
