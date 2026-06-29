import type { MotionCompletion, MotionResultCallback } from 'motion-controller'
import { notifyCompletion, notifyMaybe } from 'motion-driver-callback'
import SCServo from 'protocols/scservo'
import type { Maybe, Rotation } from 'stackchan-util'
import type Timer from 'timer'

type SCServoDriverProps = {
  panId: number
  tiltId: number
}

export class SCServoDriver {
  _pan: SCServo
  _tilt: SCServo
  _handler: ReturnType<typeof Timer.repeat>
  constructor(param: SCServoDriverProps) {
    this._pan = new SCServo({ id: param.panId })
    this._tilt = new SCServo({ id: param.tiltId })
  }

  setTorque(torque: boolean, callback?: MotionCompletion): void {
    notifyCompletion(Promise.all([this._pan.setTorque(torque), this._tilt.setTorque(torque)]), callback)
  }

  applyRotation(ori: Rotation, time = 0.5, callback?: MotionCompletion): void {
    const panAngle = 100 - (ori.y * 180) / Math.PI
    const tiltAngle = 100 - Math.min(Math.max((ori.p * 180) / Math.PI, -25), 10)
    trace(`applying (${ori.y}, ${ori.p}) => (${panAngle}, ${tiltAngle})\n`)
    if (time === 0) {
      notifyCompletion(Promise.all([this._pan.setAngle(panAngle), this._tilt.setAngle(tiltAngle)]), callback)
    } else {
      notifyCompletion(
        Promise.all([
          this._pan.setAngleInTime(panAngle, time * 1000),
          this._tilt.setAngleInTime(tiltAngle, time * 1000),
        ]),
        callback,
      )
    }
  }
  getRotation(callback: MotionResultCallback<Maybe<Rotation>>): void {
    notifyMaybe(this.#readRotation(), callback)
  }

  async #readRotation(): Promise<Maybe<Rotation>> {
    const [p1, p2] = await Promise.allSettled([this._pan.readStatus(), this._tilt.readStatus()])
    if (p1.status !== 'fulfilled' || p2.status !== 'fulfilled') {
      return {
        success: false,
        reason: 'response unavailable',
      }
    }
    if (!p1.value.success || !p2.value.success) {
      return {
        success: false,
      }
    }
    const y = (-Math.PI * (p1.value.value.angle - 90)) / 180
    const p = (-Math.PI * (p2.value.value.angle - 90)) / 180
    return {
      success: true,
      value: {
        y,
        p,
        r: 0.0,
      },
    }
  }
}
