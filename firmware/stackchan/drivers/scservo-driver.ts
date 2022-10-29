import SCServo from 'scservo'
import Timer from 'timer'

import type { Rotation } from '../stackchan-util'

export class SCServoDriver {
  _pan: SCServo
  _tilt: SCServo
  _handler: ReturnType<typeof Timer.repeat>
  _onOrientationChanged?: (ori: Rotation) => unknown
  #initialized: boolean
  set onOrientationChanged(onOrientationChanged: (ori: Rotation) => unknown) {
    this._onOrientationChanged = onOrientationChanged
  }
  get onOrientationChanged(): typeof this._onOrientationChanged {
    return this._onOrientationChanged
  }
  constructor(param: { panId: number; tiltId: number; onOrientationChanged?}) {
    this.#initialized = false
    this._pan = new SCServo({ id: param.panId })
    this._tilt = new SCServo({ id: param.tiltId })
    /*
    this._handler = Timer.repeat(this.oriLoop.bind(this), 100)
    this._onOrientationChanged = param.onOrientationChanged
    */
  }
  async #initialize(): Promise<void> {
    // await this._pan.loadSettings()
    // await this._tilt.loadSettings()
  }
  async applyRotation(ori: Rotation, time = 0.5): Promise<void> {
    const panAngle = 100 - (ori.y * 180) / Math.PI
    const tiltAngle = 100 - Math.min(Math.max((ori.p * 180) / Math.PI, -25), 10)
    trace(`applying (${ori.y}, ${ori.p}) => (${panAngle}, ${tiltAngle})\n`)
    await Promise.all([
      this._pan.setAngleInTime(panAngle, time * 1000),
      this._tilt.setAngleInTime(tiltAngle, time * 1000),
    ])
    return new Promise((resolve) => {
      Timer.set(async () => {
        await Promise.all([this._pan.setTorque(false), this._tilt.setTorque(false)])
        resolve()
      }, time * 1000 + 10)
    })
  }
  async getRotation(): Promise<Rotation> {
    const [p1, p2] = await Promise.allSettled([this._pan.readStatus(), this._tilt.readStatus()])
    if (p1.status != 'fulfilled' || p2.status != 'fulfilled') {
      return
    }
    if (p1.value == null || p2.value == null) {
      return
    }
    const y = (-Math.PI * (p1.value.angle - 90)) / 180
    const p = (Math.PI * (p2.value.angle - 90)) / 180
    return {
      y,
      p,
      r: 0.0
    }
  }
  async oriLoop(): Promise<void> {
    if (!this.#initialized) {
      this.#initialized = true
      await this.#initialize()
    }
    if (this._onOrientationChanged == null) {
      return
    }
    const [p1, p2] = await Promise.allSettled([this._pan.readStatus(), this._tilt.readStatus()])
    if (p1.status != 'fulfilled' || p2.status != 'fulfilled') {
      return
    }
    if (p1.value == null || p2.value == null) {
      return
    }
    const y = (-Math.PI * (p1.value.angle - 90)) / 180
    const p = (Math.PI * (p2.value.angle - 90)) / 180
    this._onOrientationChanged({
      r: 0,
      p,
      y,
    })
  }
}
