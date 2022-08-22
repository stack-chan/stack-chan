import SCServo from 'scservo'
import Timer from 'timer'

import type { Pose } from './robot'

export class SCServoDriver {
  _pan: SCServo
  _tilt: SCServo
  _handler: ReturnType<typeof Timer.repeat>
  _onPoseChanged?: (pose: Pose) => unknown
  set onPoseChanged(onPoseChanged: (pose: Pose) => unknown) {
    this._onPoseChanged = onPoseChanged
  }
  get onPoseChanged(): typeof this._onPoseChanged {
    return this._onPoseChanged
  }
  constructor(param: { panId: number; tiltId: number; onPoseChanged? }) {
    this._pan = new SCServo({ id: param.panId })
    this._tilt = new SCServo({ id: param.tiltId })
    this._handler = Timer.repeat(this.poseLoop.bind(this), 100)
    this._onPoseChanged = param.onPoseChanged
  }
  async applyPose(pose: Pose, time = 0.5): Promise<void> {
    const panAngle = 90 - (pose.yaw * 180) / Math.PI
    const tiltAngle = 90 - Math.min(Math.max((pose.pitch * 180) / Math.PI, -25), 10)
    trace(`applying (${pose.yaw}, ${pose.pitch}) => (${panAngle}, ${tiltAngle})\n`)
    await this._pan.setAngleInTime(panAngle, time * 1000)
    await this._tilt.setAngleInTime(tiltAngle, time * 1000)
    Timer.set(async () => {
      await this._pan.setTorque(false)
      await this._tilt.setTorque(false)
    }, time * 1000 + 10)
  }
  async poseLoop(): Promise<void> {
    if (this._onPoseChanged == null) {
      return
    }
    let status = await this._pan.readStatus()
    const yaw = (-Math.PI * (status.angle - 90)) / 180
    status = await this._tilt.readStatus()
    const pitch = (Math.PI * (status.angle - 90)) / 180
    this._onPoseChanged({
      yaw,
      pitch,
      roll: 0,
    })
  }
}
