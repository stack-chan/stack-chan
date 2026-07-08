import {
  type MotionCalibrationCapability,
  type MotionCompletion,
  type MotionDurationSeconds,
  type MotionResultCallback,
  motionDurationSecondsToMilliseconds,
} from 'motion-controller'
import { createMotionCalibrationServo } from 'motion-calibration-servo'
import SCServo from 'protocols/scservo'
import type { Maybe, Rotation } from 'stackchan-util'
import type Timer from 'timer'

type SCServoDriverProps = {
  panId: number
  tiltId: number
}

function createCalibrationServo(servo: SCServo) {
  return createMotionCalibrationServo({
    readAngle(callback) {
      servo.readStatus((result) => {
        if (!result.success) {
          callback({ success: false, reason: result.reason })
          return
        }
        callback({ success: true, value: result.value.angle })
      })
    },
    setAngle(angle, callback) {
      servo.setAngle(angle, callback)
    },
    setAngleInTime(angle, goalTimeMilliseconds, callback) {
      servo.setAngleInTime(angle, goalTimeMilliseconds, callback)
    },
    setTorque(torque, callback) {
      servo.setTorque(torque, callback)
    },
    convertDuration: motionDurationSecondsToMilliseconds,
    flashId: (id, callback) => servo.flashId(id, callback),
    readOffsetAngle(callback) {
      servo.readOffsetAngle(callback)
    },
    setOffsetAngle(angle, callback) {
      servo.setOffsetAngle(angle, callback)
    },
    saveSettings(callback) {
      servo.saveSettings(callback)
    },
  })
}

export class SCServoDriver {
  _pan: SCServo
  _tilt: SCServo
  _handler: ReturnType<typeof Timer.repeat>
  calibration: MotionCalibrationCapability
  #rotation: Rotation = { y: 0, p: 0, r: 0 }
  #rotationResult: Maybe<Rotation> = { success: true, value: this.#rotation }
  #rotationErrorResult: { success: false; reason?: string } = { success: false }

  constructor(param: SCServoDriverProps) {
    this._pan = new SCServo({ id: param.panId })
    this._tilt = new SCServo({ id: param.tiltId })
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
        this.#rotation.y = (-Math.PI * (panStatus.value.angle - 90)) / 180
        this.#rotation.p = (-Math.PI * (tiltStatus.value.angle - 90)) / 180
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
