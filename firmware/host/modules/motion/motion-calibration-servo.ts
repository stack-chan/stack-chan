import type {
  MotionCalibrationServo,
  MotionCompletion,
  MotionDurationSeconds,
  MotionResultCallback,
} from 'motion-controller'
import type { Maybe } from 'stackchan-util'

type CalibrationServoOptions = {
  readAngle(callback: MotionResultCallback<Maybe<number>>): void
  setAngle(angle: number, callback?: MotionCompletion): void
  setAngleInTime(angle: number, time: number, callback?: MotionCompletion): void
  setTorque(torque: boolean, callback?: MotionCompletion): void
  convertDuration(duration: MotionDurationSeconds): number
  flashId?(id: number, callback?: MotionCompletion): void
  readOffsetAngle?(callback: MotionResultCallback<Maybe<number>>): void
  setOffsetAngle?(angle: number, callback?: MotionCompletion): void
  saveSettings?(callback?: MotionCompletion): void
}

export function createMotionCalibrationServo(options: CalibrationServoOptions): MotionCalibrationServo {
  return {
    readAngle: options.readAngle,
    setAngle(angle, timeOrCallback?: MotionDurationSeconds | MotionCompletion, callback?: MotionCompletion) {
      if (typeof timeOrCallback === 'function') {
        options.setAngle(angle, timeOrCallback)
        return
      }
      if (timeOrCallback == null) {
        options.setAngle(angle, callback)
        return
      }
      options.setAngleInTime(angle, options.convertDuration(timeOrCallback), callback)
    },
    setTorque: options.setTorque,
    ...(options.flashId ? { flashId: options.flashId } : {}),
    ...(options.readOffsetAngle ? { readOffsetAngle: options.readOffsetAngle } : {}),
    ...(options.setOffsetAngle ? { setOffsetAngle: options.setOffsetAngle } : {}),
    ...(options.saveSettings ? { saveSettings: options.saveSettings } : {}),
  }
}
