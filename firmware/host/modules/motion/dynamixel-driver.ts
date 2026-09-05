import type { MotionCompletion, MotionDurationSeconds, MotionResultCallback } from 'motion-controller'
import Dynamixel, { OPERATING_MODE } from 'protocols/dynamixel'
import { ServoBusError } from 'servo-bus'
import { ServoDriverResources } from 'servo-driver-resources'
import type { Maybe, Rotation } from 'stackchan-util'
import Timer from 'timer'

type DynamixelDriverProps = {
  panId: number
  tiltId: number
  baud: number
  commandTimeoutMs?: number
  serial?: Partial<{
    receive: number
    transmit: number
    port: number
    baud: number
  }>
}

class PControl {
  name: string
  servo: Dynamixel
  gain: number
  saturation: number
  minCurrent: number
  goalPosition: number
  _offset: number
  _lastGoalPosition: number
  presentPosition: number
  constructor(servo: Dynamixel, gain: number, saturation: number, minCurrent: number, name = 'servo') {
    this.servo = servo
    this.gain = gain
    this.saturation = saturation
    this.minCurrent = minCurrent
    this.name = name
    this.goalPosition = 0
    this.presentPosition = 0
    this._offset = 0
    this._lastGoalPosition = 0
  }

  init(torqueEnabled: boolean, callback: MotionCompletion): void {
    this.servo.readPresentPosition((result) => {
      if (result.success === false) {
        callback(new Error(result.reason ?? 'failed to read initial servo position'))
        return
      }
      this._offset = result.value > 4096 ? 4096 : 0
      this.presentPosition = result.value - this._offset
      this.goalPosition = 2048
      // Use CURRENT_BASED_POSITION mode for dynamic torque control
      this.servo.setOperatingMode(OPERATING_MODE.CURRENT_BASED_POSITION, (modeError) => {
        if (modeError != null) {
          callback(modeError)
          return
        }
        this.servo.setTorque(torqueEnabled, callback)
      })
    })
  }

  update(callback: MotionCompletion): void {
    if (this._lastGoalPosition !== this.goalPosition) {
      this.servo.setGoalPosition(this.goalPosition + this._offset, (goalError) => {
        if (goalError != null) {
          callback(goalError)
          return
        }
        this._lastGoalPosition = this.goalPosition
        this.#updateCurrent(callback)
      })
      return
    }

    this.#updateCurrent(callback)
  }

  #updateCurrent(callback: MotionCompletion): void {
    this.servo.readPresentPosition((result) => {
      if (result.success === false) {
        callback(new Error(result.reason ?? 'failed to read servo position'))
        return
      }
      this.presentPosition = result.value - this._offset
      const position = this.presentPosition
      const positionError = Math.abs(this.goalPosition - position)
      const current = Math.min(Math.max(positionError * this.gain, this.minCurrent), this.saturation)
      this.servo.setGoalCurrent(current, (currentError) => {
        if (currentError != null) {
          callback(currentError)
          return
        }
        callback()
      })
    })
  }
}

export class DynamixelDriver {
  #resources = new ServoDriverResources()
  _pan: Dynamixel
  _tilt: Dynamixel
  _nextTimer?: ReturnType<typeof Timer.set>
  _controls: PControl[]
  _initialized: boolean
  _torque: boolean
  _running: boolean
  _attached: boolean
  _interval: number
  #rotation: Rotation = { y: 0, p: 0, r: 0 }
  #rotationResult: Maybe<Rotation> = { success: true, value: this.#rotation }
  #controlError: unknown
  #unavailableResult: Maybe<Rotation> = { success: false, reason: 'servo has no current position sample' }
  #closedResult: Maybe<Rotation> = { success: false, reason: 'servo driver is closed' }

  constructor(param: DynamixelDriverProps) {
    try {
      this._pan = this.#resources.own(
        new Dynamixel({
          id: param.panId,
          baudrate: param.baud,
          commandTimeoutMs: param.commandTimeoutMs,
          serial: param.serial,
        }),
      )
      this._tilt = this.#resources.own(
        new Dynamixel({
          id: param.tiltId,
          baudrate: param.baud,
          commandTimeoutMs: param.commandTimeoutMs,
          serial: param.serial,
        }),
      )
      this._controls = [new PControl(this._pan, 1.0, 80, 40, 'pan'), new PControl(this._tilt, 4, 800, 0, 'tilt')]
      this._torque = true
      this._initialized = false
      this._running = false
      this._attached = false
      this._interval = 125
      this.#resources.own({ close: () => this.onDetached() })
    } catch (error) {
      this.#resources.rollback(error)
    }
  }

  close(): void {
    this.#resources.close()
  }

  setTorque(torque: boolean, callback?: MotionCompletion): void {
    this._torque = torque
    this.#setTorqueAt(0, torque, callback)
  }

  #setTorqueAt(index: number, torque: boolean, callback?: MotionCompletion): void {
    if (index >= this._controls.length) {
      callback?.()
      return
    }
    this._controls[index].servo.setTorque(torque, (error) => {
      if (error != null) {
        callback?.(error)
        return
      }
      this.#setTorqueAt(index + 1, torque, callback)
    })
  }

  onAttached(): void {
    if (this.#controlError) throw this.#controlError
    if (this.#resources.closed) throw new ServoBusError('CLOSED', 'servo driver is closed')
    if (this._attached) {
      return
    }
    this._attached = true
    this._scheduleNext()
  }

  onDetached(): void {
    this._attached = false
    if (this._nextTimer) {
      Timer.clear(this._nextTimer)
      this._nextTimer = undefined
    }
  }

  control(callback?: MotionCompletion): void {
    if (this.#resources.closed) {
      callback?.(new ServoBusError('CLOSED', 'servo driver is closed'))
      return
    }
    if (this.#controlError) {
      callback?.(this.#controlError)
      return
    }
    if (this._running) {
      callback?.(new ServoBusError('BUSY', 'servo control is already running'))
      return
    }
    this._running = true
    if (!this._initialized) {
      this.#initialize((error) => {
        if (error != null) {
          this.#finishControl(error, callback)
          return
        }
        this._initialized = true
        if (!this._torque) {
          this.#finishControl(undefined, callback)
          return
        }
        this.#updateControlAt(0, callback)
      })
      return
    }
    if (!this._torque) {
      this.#finishControl(undefined, callback)
      return
    }
    this.#updateControlAt(0, callback)
  }

  #initialize(callback: MotionCompletion): void {
    this.#initializeControlAt(0, (initError) => {
      if (initError != null) {
        callback(initError)
        return
      }
      this._pan.setProfileAcceleration(20, (accelError) => {
        if (accelError != null) {
          callback(accelError)
          return
        }
        this._pan.setProfileVelocity(100, (velocityError) => {
          if (velocityError == null) {
            trace('servo initialized\n')
          }
          callback(velocityError)
        })
      })
    })
  }

  #initializeControlAt(index: number, callback: MotionCompletion): void {
    if (index >= this._controls.length) {
      callback()
      return
    }
    this._controls[index].init(this._torque, (error) => {
      if (error != null) {
        callback(error)
        return
      }
      this.#initializeControlAt(index + 1, callback)
    })
  }

  #updateControlAt(index: number, callback?: MotionCompletion): void {
    if (index >= this._controls.length) {
      this.#finishControl(undefined, callback)
      return
    }
    // TODO: use bulk write/read instruction for performance
    this._controls[index].update((error) => {
      if (error != null) {
        this.#finishControl(error, callback)
        return
      }
      this.#updateControlAt(index + 1, callback)
    })
  }

  #finishControl(error?: unknown, callback?: MotionCompletion): void {
    if (error != null) {
      this.#controlError = error
      this.onDetached()
      trace(`[DynamixelDriver] control failed: ${String(error)}\n`)
    }
    this._running = false
    if (this._attached) {
      this._scheduleNext()
    }
    callback?.(error)
  }

  _scheduleNext(): void {
    if (this._nextTimer || !this._attached) {
      return
    }
    this._nextTimer = Timer.set(() => {
      this._nextTimer = undefined
      this.control()
    }, this._interval)
  }

  applyRotation(ori: Rotation, _time: MotionDurationSeconds = 0.5, callback?: MotionCompletion): void {
    if (this.#resources.closed) {
      callback?.(new ServoBusError('CLOSED', 'servo driver is closed'))
      return
    }
    if (this.#controlError) {
      callback?.(this.#controlError)
      return
    }
    const panAngle = (ori.y * 180) / Math.PI
    const tiltAngle = (ori.p * 180) / Math.PI
    this._controls[0].goalPosition = Math.floor(((panAngle + 180) * 4096) / 360)
    this._controls[1].goalPosition = Math.floor(((Math.min(Math.max(tiltAngle, -30), 10) + 180) * 4096) / 360)
    callback?.()
  }

  getRotation(callback: MotionResultCallback<Maybe<Rotation>>): void {
    if (this.#resources.closed) {
      callback(this.#closedResult)
      return
    }
    if (!this._initialized || this.#controlError) {
      callback(this.#unavailableResult)
      return
    }
    const p1 = (this._controls[0].presentPosition * 360) / 4096 - 180
    const p2 = (this._controls[1].presentPosition * 360) / 4096 - 180
    this.#rotation.y = (p1 * Math.PI) / 180
    this.#rotation.p = (p2 * Math.PI) / 180
    this.#rotation.r = 0.0
    callback(this.#rotationResult)
  }
}
