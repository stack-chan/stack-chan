import SCServo from 'scservo'
import Timer from 'timer'

import type { Pose } from './robot'

export class SCServoDriver {
  _pan: SCServo
  _tilt: SCServo
  _handler: ReturnType<typeof Timer.repeat>
  _onPoseChanged?: (pose: Pose) => unknown
  #initialized: boolean
  set onPoseChanged(onPoseChanged: (pose: Pose) => unknown) {
    this._onPoseChanged = onPoseChanged
  }
  get onPoseChanged(): typeof this._onPoseChanged {
    return this._onPoseChanged
  }
  constructor(param: { panId: number; tiltId: number; onPoseChanged? }) {
    this.#initialized = false
    this._pan = new SCServo({ id: param.panId })
    this._tilt = new SCServo({ id: param.tiltId })
    this._handler = Timer.repeat(this.poseLoop.bind(this), 100)
    this._onPoseChanged = param.onPoseChanged
  }
  async #initialize(): Promise<void> {
    // await this._pan.loadSettings()
    // await this._tilt.loadSettings()
  }
  async applyPose(pose: Pose, time = 0.5): Promise<void> {
    const panAngle = 100 - (pose.yaw * 180) / Math.PI
    const tiltAngle = 100 - Math.min(Math.max((pose.pitch * 180) / Math.PI, -25), 10)
    trace(`applying (${pose.yaw}, ${pose.pitch}) => (${panAngle}, ${tiltAngle})\n`)
    await Promise.all([
      this._pan.setAngleInTime(panAngle, time * 1000),
      this._tilt.setAngleInTime(tiltAngle, time * 1000),
    ])
    Timer.set(async () => {
      await Promise.all([this._pan.setTorque(false), this._tilt.setTorque(false)])
    }, time * 1000 + 10)
  }
  async poseLoop(): Promise<void> {
    if (!this.#initialized) {
      this.#initialized = true
      await this.#initialize()
    }
    if (this._onPoseChanged == null) {
      return
    }
    const [p1, p2] = await Promise.allSettled([this._pan.readStatus(), this._tilt.readStatus()])
    if (p1.status != 'fulfilled' || p2.status != 'fulfilled') {
      return
    }
    if (p1.value == null || p2.value == null) {
      return
    }
    const yaw = (-Math.PI * (p1.value.angle - 90)) / 180
    const pitch = (Math.PI * (p2.value.angle - 90)) / 180
    this._onPoseChanged({
      yaw,
      pitch,
      roll: 0,
    })
  }
}
