import Dynamixel, { OPERATING_MODE } from 'dynamixel'
import Timer from 'timer'
import type { Maybe, Rotation } from 'stackchan-util'

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
  goalPosition: number
  _lastGoalPosition: number
  presentPosition: number
  constructor(servo: Dynamixel, gain, saturation, name = 'servo') {
    this.servo = servo
    this.gain = gain
    this.saturation = saturation
    this.name = name
    this.goalPosition = 0
    this.presentPosition = 0
    this._lastGoalPosition = 0
  }

  async init() {
    this.goalPosition = 2048
    await this.servo.setOperatingMode(OPERATING_MODE.CURRENT_BASED_POSITION)
    await this.servo.setTorque(true)
  }

  async update() {
    // trace(`${this.name} ... update\n`)
    if (this._lastGoalPosition !== this.goalPosition) {
      trace(`${this.name} ... updating goal position to ${this.goalPosition}\n`)
      await this.servo.setGoalPosition(this.goalPosition)
      this._lastGoalPosition = this.goalPosition
    }
    const result = await this.servo.readPresentPosition()
    if (!result.success) {
      trace(`${this.name} ... failed to update\n`)
      return
    }
    const position = (this.presentPosition = result.value)
    const current = Math.min(Math.abs(this.goalPosition - position) * this.gain, this.saturation)
    // trace(`servo ${this.name} ... (${position}, ${this.goalPosition}, ${this.gain}, ${this.saturation}, ${current})\n`)
    await this.servo.setGoalCurrent(current)
  }
}

export class DynamixelDriver {
  _pan: Dynamixel
  _tilt: Dynamixel
  _handler: ReturnType<typeof Timer.repeat>
  _controls: PControl[]
  _initialized: boolean
  _torque: boolean
  constructor(param: DynamixelDriverProps) {
    this._pan = new Dynamixel({ id: param.panId, baudrate: param.baud })
    this._tilt = new Dynamixel({ id: param.tiltId, baudrate: param.baud })
    this._controls = [new PControl(this._pan, 0.15, 80, 'pan'), new PControl(this._tilt, 4, 800, 'tilt')]
    this._torque = true
  }

  async setTorque(torque: boolean): Promise<void> {
    this._torque = torque
  }

  onAttached(): void {
    this._handler = Timer.repeat(this.control.bind(this), 125)
  }

  onDetached(): void {
    Timer.clear(this._handler)
  }

  async control(): Promise<void> {
    if (!this._initialized) {
      this._initialized = true
      for (const c of this._controls) {
        await c.init()
      }
      await this._pan.setProfileAcceleration(20)
      await this._pan.setProfileVelocity(100)
      trace('servo initialized\n')
    }
    // TODO: use bulk write/read instruction for performance
    for (const c of this._controls) {
      await c.update()
    }
  }

  async applyRotation(ori: Rotation): Promise<void> {
    const panAngle = (ori.y * 180) / Math.PI
    const tiltAngle = (ori.p * 180) / Math.PI
    trace(`applying (${ori.y}, ${ori.p}) => (${panAngle}, ${tiltAngle})\n`)
    this._controls[0].goalPosition = Math.floor(((panAngle + 180) * 4096) / 360)
    this._controls[1].goalPosition = Math.floor(((Math.min(Math.max(tiltAngle, -30), 10) + 180) * 4096) / 360)
  }

  async getRotation(): Promise<Maybe<Rotation>> {
    const [p1, p2] = this._controls.map((c) => (c.presentPosition * 360) / 4096 - 180)
    // trace(`got (${p1}, ${p2}) => (${(p1 * Math.PI) / 180}, ${(p2 * Math.PI) / 180})\n`)
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
