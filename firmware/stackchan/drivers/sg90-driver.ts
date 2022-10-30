import Servo from 'pins/servo'
import Timer from 'timer'
import config from 'mc/config'

const INTERVAL = 16.5

function easeInOutSine(ratio) {
  return -(Math.cos(Math.PI * ratio) - 1) / 2;
}

export class PWMServoDriver {
  _pan
  _tilt
  _panRef
  _tiltRef
  _poseHandler
  _driveHandler
  _range
  _onPoseChanged
  set onPoseChanged(onPoseChanged) {
    this._onPoseChanged = onPoseChanged
  }
  get onPoseChanged() {
    return this._onPoseChanged
  }
  constructor(param: { onPoseChanged? } = {}) {
    const pwmPan = config.servo?.pwmPan || 5
    const pwmTilt = config.servo?.pwmTilt || 2
    this._pan = new Servo({
      pin: pwmPan,
      min: 500,
      max: 2400,
    })
    this._tilt = new Servo({
      pin: pwmTilt,
      min: 500,
      max: 2400,
    })
    this._panRef = {
      current: 0,
    }
    this._tiltRef = {
      current: 0,
    }
    this._poseHandler = Timer.repeat(this.poseLoop.bind(this), 100)
    this._onPoseChanged = param.onPoseChanged
  }
  async applyRotation(pose, time = 0.5) {
    trace(`applyPose: ${JSON.stringify(pose)}\n`)
    if (this._driveHandler != null) {
      trace('clearing\n')
      Timer.clear(this._driveHandler)
      this._driveHandler = null
    }
    const offsetPan = config.servo.offsetPan
    const offsetTilt = config.servo.offsetTilt
    const startPan = this._panRef.current
    const startTilt = this._tiltRef.current
    const diffPan = (pose.yaw * 180) / Math.PI - startPan
    const diffTilt = (pose.pitch * 180) / Math.PI - startTilt
    let cnt = 0
    const numFrame = (time * 1000) / INTERVAL
    this._driveHandler = Timer.repeat(() => {
      if (cnt >= numFrame) {
        Timer.clear(this._driveHandler)
        this._driveHandler = null
      }
      const ratio = easeInOutSine(cnt / numFrame)
      const p = startPan + diffPan * ratio
      const t = startTilt + diffTilt * ratio
      const writingPan = Math.max(Math.min(p + 90, 170), 10) + offsetPan
      const writingTilt = Math.max(Math.min(t + 90, 100), 65) + offsetTilt
      this._pan.write(writingPan)
      this._tilt.write(writingTilt)
      this._panRef.current = p
      this._tiltRef.current = t
      cnt += 1
    }, INTERVAL)
  }
  async getRotation() {
    return {
      success: true,
      value: {
        y: (Math.PI * this._panRef.current) / 180,
        p: (Math.PI * this._tiltRef.current) / 180,
        r: 0.0,
      },
    }
  }
  poseLoop() {
    if (this._onPoseChanged == null) {
      return
    }
    const yaw = (Math.PI * this._panRef.current) / 180
    const pitch = (Math.PI * this._tiltRef.current) / 180
    this._onPoseChanged({
      yaw,
      pitch,
      roll: 0,
    })
  }
}
