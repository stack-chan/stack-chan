import PWM from 'embedded:io/pwm'
import {
  type MotionCompletion,
  type MotionDurationSeconds,
  type MotionResultCallback,
  motionDurationSecondsToMilliseconds,
} from 'motion-driver'
import { directMotionPort, type MotionPort, motionInfo } from 'motion-port'
import type { Maybe, Rotation } from 'stackchan-util'
import Timer from 'timer'

const INTERVAL = 16.5
const CLOSED_ROTATION: Maybe<Rotation> = { success: false, reason: 'PWM driver is closed' }

class Servo {
  #pwm: PWM
  #min: number
  #max: number

  constructor(param: { pin: number; min?: number; max?: number }) {
    const TAREGET_PERIOD = 18
    this.#pwm = new PWM({
      pin: param.pin,
      hz: Math.floor(1000 / TAREGET_PERIOD),
    })

    const min = param.min ?? 500
    const max = param.max ?? 2400
    const range = 2 ** this.#pwm.resolution - 1
    this.#min = Math.ceil((min / 1000 / TAREGET_PERIOD) * range)
    this.#max = Math.floor((max / 1000 / TAREGET_PERIOD) * range)
  }

  write(degrees: number): void {
    const value = Math.round(this.#min + (degrees / 180) * (this.#max - this.#min))
    this.#pwm.write(value)
  }

  close(): void {
    this.#pwm.close()
  }
}

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
  readonly motion: MotionPort
  _pan
  _tilt
  _panRef
  _tiltRef
  _driveHandler
  _range
  _offsetPan
  _offsetTilt
  #rotation: Rotation = { y: 0, p: 0, r: 0 }
  #rotationResult: Maybe<Rotation> = { success: true, value: this.#rotation }
  #closed = false

  constructor(param: PWMServoDriverProps = {}) {
    const pwmPan = param.pwmPan ?? 5
    const pwmTilt = param.pwmTilt ?? 2
    this._pan = new Servo({
      pin: pwmPan,
      min: 500,
      max: 2400,
    })
    try {
      this._tilt = new Servo({ pin: pwmTilt, min: 500, max: 2400 })
    } catch (error) {
      this._pan.close()
      throw error
    }
    this._panRef = {
      current: 0,
    }
    this._tiltRef = {
      current: 0,
    }
    this._offsetPan = param.offsetPan ?? 0
    this._offsetTilt = param.offsetTilt ?? 0
    this.motion = directMotionPort(
      this,
      motionInfo(
        'estimated',
        [Math.max(-80, -90 - this._offsetPan), Math.min(80, 90 - this._offsetPan)],
        [Math.max(-25, -90 - this._offsetTilt), Math.min(10, 90 - this._offsetTilt)],
        false,
      ),
      INTERVAL,
    )
  }

  setTorque(_torque: boolean, callback?: MotionCompletion): void {
    if (this.#closed) {
      this.#fail(new Error('PWM driver is closed'), callback)
      return
    }
    // We cannot change torque via Stack-chan board for now.
    // torque keeps on while 5V supplied.
    callback?.()
  }

  applyRotation(rotation: Rotation, time: MotionDurationSeconds = 0.5, callback?: MotionCompletion): void {
    if (
      this.#closed ||
      !Number.isFinite(time) ||
      time < 0 ||
      ![rotation.y, rotation.p, rotation.r].every(Number.isFinite)
    ) {
      this.#fail(new Error(this.#closed ? 'PWM driver is closed' : 'Invalid PWM rotation or duration'), callback)
      return
    }
    this.onDetached()
    const startPan = this._panRef.current
    const startTilt = this._tiltRef.current
    const diffPan = (rotation.y * 180) / Math.PI - startPan
    const diffTilt = (rotation.p * 180) / Math.PI - startTilt
    if (time === 0) {
      this.#write(startPan + diffPan, startTilt + diffTilt)
      callback?.()
      return
    }
    // The legacy callback acknowledges the first command. V2 motion waits for
    // the trajectory separately; never divide by a zero frame count.
    this.#write(startPan, startTilt)
    let cnt = 0
    const numFrame = Math.max(1, Math.ceil(motionDurationSecondsToMilliseconds(time) / INTERVAL))
    this._driveHandler = Timer.repeat(() => {
      cnt += 1
      const ratio = easeInOutSine(cnt / numFrame)
      const p = startPan + diffPan * ratio
      const t = startTilt + diffTilt * ratio
      this.#write(p, t)
      if (cnt >= numFrame) this.onDetached()
    }, INTERVAL)
    callback?.()
  }

  getRotation(callback: MotionResultCallback<Maybe<Rotation>>): void {
    if (this.#closed) {
      callback(CLOSED_ROTATION)
      return
    }
    this.#rotation.y = (Math.PI * this._panRef.current) / 180
    this.#rotation.p = (Math.PI * this._tiltRef.current) / 180
    this.#rotation.r = 0.0
    callback(this.#rotationResult)
  }

  onDetached(): void {
    if (this._driveHandler == null) return
    Timer.clear(this._driveHandler)
    this._driveHandler = null
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.onDetached()
    try {
      this._pan.close()
    } finally {
      this._tilt.close()
    }
  }

  #write(pan: number, tilt: number): void {
    const limitedPan = Math.max(Math.min(pan, 80), -80)
    const limitedTilt = Math.max(Math.min(tilt, 10), -25)
    this._pan.write(Math.max(0, Math.min(180, limitedPan + 90 + this._offsetPan)))
    this._tilt.write(Math.max(0, Math.min(180, limitedTilt + 90 + this._offsetTilt)))
    this._panRef.current = limitedPan
    this._tiltRef.current = limitedTilt
  }

  #fail(error: Error, callback?: MotionCompletion): void {
    if (callback) callback(error)
    else throw error
  }
}
