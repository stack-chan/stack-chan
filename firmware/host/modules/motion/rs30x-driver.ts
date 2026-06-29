import type { MotionCompletion, MotionResultCallback } from 'motion-controller'
import { reasonFromError } from 'motion-driver-callback'
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
    this._pan.setTorque(torque, (panError) => {
      if (panError != null) {
        callback?.(panError)
        return
      }
      this._tilt.setTorque(torque, callback)
    })
  }

  applyRotation(ori: Rotation, time = 0.5, callback?: MotionCompletion): void {
    const panAngle = -(ori.y * 180) / Math.PI
    const tiltAngle = Math.min(Math.max((-ori.p * 180) / Math.PI, -25), 10)
    trace(`applying (${ori.y}, ${ori.p}) => (${panAngle}, ${tiltAngle})\n`)
    if (time === 0) {
      this._pan.setAngle(panAngle, (panError) => {
        if (panError != null) {
          callback?.(panError)
          return
        }
        this._tilt.setAngle(tiltAngle, callback)
      })
    } else {
      this._pan.setAngleInTime(panAngle, time, (panError) => {
        if (panError != null) {
          callback?.(panError)
          return
        }
        this._tilt.setAngleInTime(tiltAngle, time, callback)
      })
    }
  }

  getRotation(callback: MotionResultCallback<Maybe<Rotation>>): void {
    this._pan.readStatus((yawAngle, yawError) => {
      if (yawAngle == null) {
        callback({
          success: false,
          reason: yawError == null ? 'response corrupted.' : reasonFromError(yawError),
        })
        return
      }
      this._tilt.readStatus((tiltAngle, tiltError) => {
        if (tiltAngle == null) {
          callback({
            success: false,
            reason: tiltError == null ? 'response corrupted.' : reasonFromError(tiltError),
          })
          return
        }
        const y = (-Math.PI * yawAngle) / 180
        const p = (-Math.PI * tiltAngle) / 180
        callback({
          success: true,
          value: {
            y,
            p,
            r: 0.0,
          },
        })
      })
    })
  }
}
