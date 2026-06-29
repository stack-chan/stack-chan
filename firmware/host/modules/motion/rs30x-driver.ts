import type { MotionCompletion, MotionResultCallback } from 'motion-controller'
import { notifyCompletion, notifyMaybe } from 'motion-driver-callback'
import RS30X from 'protocols/rs30x'
import type { Maybe, Rotation } from 'stackchan-util'
import type Timer from 'timer'

type RS30XDriverProps = {
  panId: number
  tiltId: number
}

export class RS30XDriver {
  _pan: RS30X
  _tilt: RS30X
  _handler: ReturnType<typeof Timer.repeat>
  constructor(param: RS30XDriverProps) {
    this._pan = new RS30X({ id: param.panId })
    this._tilt = new RS30X({ id: param.tiltId })
  }

  setTorque(torque: boolean, callback?: MotionCompletion): void {
    notifyCompletion(this.#setTorque(torque), callback)
  }

  async #setTorque(torque: boolean): Promise<void> {
    await this._pan.setTorque(torque)
    await this._tilt.setTorque(torque)
  }

  applyRotation(ori: Rotation, time = 0.5, callback?: MotionCompletion): void {
    notifyCompletion(this.#applyRotation(ori, time), callback)
  }

  async #applyRotation(ori: Rotation, time = 0.5): Promise<void> {
    const panAngle = -(ori.y * 180) / Math.PI
    const tiltAngle = Math.min(Math.max((-ori.p * 180) / Math.PI, -25), 10)
    trace(`applying (${ori.y}, ${ori.p}) => (${panAngle}, ${tiltAngle})\n`)
    if (time === 0) {
      await this._pan.setAngle(panAngle)
      await this._tilt.setAngle(tiltAngle)
    } else {
      await this._pan.setAngleInTime(panAngle, time)
      await this._tilt.setAngleInTime(tiltAngle, time)
    }
  }

  getRotation(callback: MotionResultCallback<Maybe<Rotation>>): void {
    notifyMaybe(this.#readRotation(), callback)
  }

  async #readRotation(): Promise<Maybe<Rotation>> {
    const yawAngle = await this._pan.readStatus().catch((): null => null)
    const tiltAngle = await this._tilt.readStatus().catch((): null => null)
    if (yawAngle == null || tiltAngle == null) {
      return {
        success: false,
        reason: 'response corrupted.',
      }
    }
    const y = (-Math.PI * yawAngle) / 180
    const p = (-Math.PI * tiltAngle) / 180
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
