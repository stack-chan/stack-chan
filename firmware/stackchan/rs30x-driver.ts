import RS30X, { Rotation, RS30XBatch, TorqeMode } from 'rs30x'
import Timer from 'timer'

import type { Pose } from './robot'

export class RS30XDriver {
  _pan: RS30X
  _tilt: RS30X
  _handler: ReturnType<typeof Timer.repeat>
  _onPoseChanged?: (pose: Pose) => unknown
  set onPoseChanged(onPoseChanged: (pose: Pose) => unknown) {
    this._onPoseChanged = onPoseChanged
  }
  get onPoseChanged() {
    return this._onPoseChanged
  }
  constructor(param: { panId: number; tiltId: number; onPoseChanged? }) {
    this._pan = new RS30X({ id: param.panId })
    this._tilt = new RS30X({ id: param.tiltId })
    this._handler = Timer.repeat(this.poseLoop.bind(this), 100)
    this._onPoseChanged = param.onPoseChanged
    this._tilt.setComplianceSlope(Rotation.CW, 0x24)
    this._tilt.setComplianceSlope(Rotation.CCW, 0x24)
  }
  applyPose(pose: Pose, time: number = 0.5) {
    const panAngle = -pose.yaw * 180 / Math.PI
    const tiltAngle = Math.min(Math.max(-pose.pitch * 180 / Math.PI, -25), 10) 
    this._pan.setTorqueMode(TorqeMode.ON)
    this._tilt.setTorqueMode(TorqeMode.ON)
    this._pan.setAngleInTime(panAngle, time)
    this._tilt.setAngleInTime(tiltAngle, time)
    Timer.set(() => {
      this._pan.setTorqueMode(TorqeMode.OFF)
      this._tilt.setTorqueMode(TorqeMode.OFF)
    }, time * 1000 + 10)
  }
  poseLoop() {
    if (this._onPoseChanged == null) {
      return
    }
    let status = this._pan.readStatus()
    const yaw = (-Math.PI * status.angle) / 180
    status = this._tilt.readStatus()
    const pitch = (Math.PI * status.angle) / 180
    this._onPoseChanged({
      yaw,
      pitch,
      roll: 0,
    })
  }
}
