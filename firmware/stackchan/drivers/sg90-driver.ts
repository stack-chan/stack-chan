import Servo from 'pins/servo'
import { Maybe, Rotation } from 'stackchan-util'
import Timer from 'timer'

const INTERVAL = 16.5

function easeInOutSine(ratio) {
  return -(Math.cos(Math.PI * ratio) - 1) / 2
}

type PWMServoDriverProps = {
  pwmPan?: number
  pwmTilt?: number
  offsetPan?: number
  offsetTilt?: number
}
export class PWMServoDriver {
  _pan
  _tilt
  _panRef
  _tiltRef
  _driveHandler
  _range
  _offsetPan
  _offsetTilt

  constructor(param: PWMServoDriverProps = {}) {
    const pwmPan = param.pwmPan ?? 5
    const pwmTilt = param.pwmTilt ?? 2
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
    this._offsetPan = param.offsetPan ?? 0
    this._offsetTilt = param.offsetTilt ?? 0
  }

  async setTorque(/* torque: boolean */): Promise<void> {
    // We cannot change torque via Stack-chan board for now.
    // torque keeps on while 5V supplied.
    return
  }

  async applyRotation(rotation: Rotation, time = 0.5): Promise<void> {
    trace(`applyPose: ${JSON.stringify(rotation)}\n`)
    if (this._driveHandler != null) {
      trace('clearing\n')
      Timer.clear(this._driveHandler)
      this._driveHandler = null
    }
    const startPan = this._panRef.current
    const startTilt = this._tiltRef.current
    const diffPan = (rotation.y * 180) / Math.PI - startPan
    const diffTilt = (rotation.p * 180) / Math.PI - startTilt
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
      const writingPan = Math.max(Math.min(p + 90, 170), 10) + this._offsetPan
      const writingTilt = Math.max(Math.min(t + 90, 100), 65) + this._offsetTilt
      this._pan.write(writingPan)
      this._tilt.write(writingTilt)
      this._panRef.current = p
      this._tiltRef.current = t
      cnt += 1
    }, INTERVAL)
  }

  async getRotation(): Promise<Maybe<Rotation>> {
    return {
      success: true,
      value: {
        y: (Math.PI * this._panRef.current) / 180,
        p: (Math.PI * this._tiltRef.current) / 180,
        r: 0.0,
      },
    }
  }
}
