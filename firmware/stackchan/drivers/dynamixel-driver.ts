import Dynamixel, { OPERATING_MODE } from 'dynamixel'
import type { Maybe, Rotation } from 'stackchan-util'
import Timer from 'timer'

type DynamixelDriverProps = {
  panId: number
  tiltId: number
  baud: number
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

  async init(torqueEnabled: boolean) {
    const result = await this.servo.readPresentPosition()
    if (result.success && result.value > 4096) {
      this._offset = 4096
    } else if (!result.success) {
      trace(`${this.name} ... failed to read initial position for offset detection\n`)
    }
    this.goalPosition = 2048
    // Use CURRENT_BASED_POSITION mode for dynamic torque control
    await this.servo.setOperatingMode(OPERATING_MODE.CURRENT_BASED_POSITION)
    await this.servo.setTorque(torqueEnabled)
  }

  async update() {
    if (this._lastGoalPosition !== this.goalPosition) {
      await this.servo.setGoalPosition(this.goalPosition + this._offset)
      this._lastGoalPosition = this.goalPosition
    }

    const result = await this.servo.readPresentPosition()
    if (!result.success) {
      return
    }
    this.presentPosition = result.value - this._offset
    const position = this.presentPosition
    const positionError = Math.abs(this.goalPosition - position)
    const current = Math.min(Math.max(positionError * this.gain, this.minCurrent), this.saturation)
    await this.servo.setGoalCurrent(current)
  }
}

export class DynamixelDriver {
  _pan: Dynamixel
  _tilt: Dynamixel
  _nextTimer?: ReturnType<typeof Timer.set>
  _controls: PControl[]
  _initialized: boolean
  _torque: boolean
  _running: boolean
  _attached: boolean
  _interval: number
  constructor(param: DynamixelDriverProps) {
    this._pan = new Dynamixel({ id: param.panId, baudrate: param.baud })
    this._tilt = new Dynamixel({ id: param.tiltId, baudrate: param.baud })
    this._controls = [new PControl(this._pan, 1.0, 80, 40, 'pan'), new PControl(this._tilt, 4, 800, 0, 'tilt')]
    this._torque = true
    this._initialized = false
    this._running = false
    this._attached = false
    this._interval = 125
  }

  async setTorque(torque: boolean): Promise<void> {
    this._torque = torque
    // Avoid temporary array/promise allocations on low-memory targets.
    for (const control of this._controls) {
      await control.servo.setTorque(torque)
    }
  }

  onAttached(): void {
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

  async control(): Promise<void> {
    if (this._running) {
      return
    }
    this._running = true
    try {
      if (!this._initialized) {
        this._initialized = true
        for (const c of this._controls) {
          await c.init(this._torque)
        }
        await this._pan.setProfileAcceleration(20)
        await this._pan.setProfileVelocity(100)
        trace('servo initialized\n')
      }
      if (!this._torque) {
        return
      }
      // TODO: use bulk write/read instruction for performance
      for (const c of this._controls) {
        await c.update()
      }
    } finally {
      this._running = false
      if (this._attached) {
        this._scheduleNext()
      }
    }
  }

  _scheduleNext(): void {
    if (this._nextTimer || !this._attached) {
      return
    }
    this._nextTimer = Timer.set(() => {
      this._nextTimer = undefined
      void this.control()
    }, this._interval)
  }

  async applyRotation(ori: Rotation): Promise<void> {
    const panAngle = (ori.y * 180) / Math.PI
    const tiltAngle = (ori.p * 180) / Math.PI
    this._controls[0].goalPosition = Math.floor(((panAngle + 180) * 4096) / 360)
    this._controls[1].goalPosition = Math.floor(((Math.min(Math.max(tiltAngle, -30), 10) + 180) * 4096) / 360)
  }

  async getRotation(): Promise<Maybe<Rotation>> {
    const [p1, p2] = this._controls.map((c) => (c.presentPosition * 360) / 4096 - 180)
    return {
      success: true,
      value: {
        y: (p1 * Math.PI) / 180,
        p: (p2 * Math.PI) / 180,
        r: 0.0,
      },
    }
  }
}
