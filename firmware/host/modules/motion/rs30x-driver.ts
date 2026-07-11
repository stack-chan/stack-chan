import { createMotionCalibrationServo } from 'motion-calibration-servo'
import {
  type MotionCalibrationCapability,
  type MotionCompletion,
  type MotionDurationSeconds,
  type MotionResultCallback,
  motionDurationSecondsToCentiseconds,
} from 'motion-controller'
import { reasonFromError } from 'motion-driver-callback'
import RS30X from 'protocols/rs30x'
import type { Maybe, Rotation } from 'stackchan-util'
import type Timer from 'timer'

type RS30XDriverProps = {
  panId: number
  tiltId: number
}

function createCalibrationServo(servo: RS30X) {
  return createMotionCalibrationServo({
    readAngle(callback) {
      servo.readStatus((angle, error) => {
        if (angle == null) {
          callback({ success: false, reason: error == null ? 'response corrupted' : reasonFromError(error) })
          return
        }
        callback({ success: true, value: angle })
      })
    },
    setAngle(angle, callback) {
      servo.setAngle(angle, callback)
    },
    setAngleInTime(angle, goalTimeCentiseconds, callback) {
      servo.setAngleInTime(angle, goalTimeCentiseconds, callback)
    },
    setTorque(torque, callback) {
      servo.setTorque(torque, callback)
    },
    convertDuration: motionDurationSecondsToCentiseconds,
    flashId: (id, callback) => servo.flashId(id, callback),
  })
}

export class RS30XDriver {
  _pan: RS30X
  _tilt: RS30X
  _handler: ReturnType<typeof Timer.repeat>
  calibration: MotionCalibrationCapability
  #rotation: Rotation = { y: 0, p: 0, r: 0 }
  #rotationResult: Maybe<Rotation> = { success: true, value: this.#rotation }
  #rotationErrorResult: { success: false; reason?: string } = { success: false }

  constructor(param: RS30XDriverProps) {
    this._pan = new RS30X({ id: param.panId })
    this._tilt = new RS30X({ id: param.tiltId })
    this.calibration = {
      pan: createCalibrationServo(this._pan),
      tilt: createCalibrationServo(this._tilt),
    }
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
