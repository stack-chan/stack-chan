import RS30X from 'rs30x'
import Timer from 'timer'
import type { Maybe, Rotation } from '../stackchan-util'

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

  async setTorque(torque: boolean): Promise<void> {
    await this._pan.setTorque(torque)
    await this._tilt.setTorque(torque)
    // await Promise.all([this._pan.setTorque(torque), this._tilt.setTorque(torque)])
  }

  async applyRotation(ori: Rotation, time = 0.5): Promise<void> {
    const panAngle = -(ori.y * 180) / Math.PI
    const tiltAngle = Math.min(Math.max((-ori.p * 180) / Math.PI, -25), 10)
    trace(`applying (${ori.y}, ${ori.p}) => (${panAngle}, ${tiltAngle})\n`)
    if (time === 0) {
      await this._pan.setAngle(panAngle)
      await this._tilt.setAngle(tiltAngle)
      // await Promise.all([this._pan.setAngle(panAngle), this._tilt.setAngle(tiltAngle)])
    } else {
      await this._pan.setAngleInTime(panAngle, time)
      await this._tilt.setAngleInTime(tiltAngle, time)
      // await Promise.all([this._pan.setAngleInTime(panAngle, time), this._tilt.setAngleInTime(tiltAngle, time)])
    }
  }
  async getRotation(): Promise<Maybe<Rotation>> {
    const yawAngle = await this._pan.readStatus().catch((): null => null)
    const tiltAngle = await this._tilt.readStatus().catch((): null => null)
    const y = (-Math.PI * yawAngle) / 180
    const p = (-Math.PI * tiltAngle) / 180
    // const [p1, p2] = await Promise.allSettled([this._pan.readStatus(), this._tilt.readStatus()])
    // if (p1.status != 'fulfilled' || p2.status != 'fulfilled') {
    //   return {
    //     success: false,
    //     reason: 'response corrupted',
    //   }
    // }
    // const y = (-Math.PI * p1.value) / 180
    // const p = (-Math.PI * p2.value) / 180
    // trace(`got rotation: (${p1.value}, ${p2.value}) => (${y}, ${p}) => \n`)
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
