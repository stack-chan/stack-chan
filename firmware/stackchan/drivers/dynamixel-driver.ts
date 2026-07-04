import Dynamixel, { OPERATING_MODE } from 'dynamixel'
import type { Maybe, Rotation } from 'stackchan-util'
import Timer from 'timer'

type DynamixelDriverProps = {
  panId: number
  tiltId: number
  baud?: number
  baudrate?: number
  interval?: number
  feedback?: boolean | number
}

const DEFAULT_BAUD = 1_000_000
const DEFAULT_INTERVAL = 125

function toPositiveInteger(value: number | undefined, fallback: number): number {
  if (value == null) {
    return fallback
  }
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n) || n <= 0) {
    return fallback
  }
  return n
}

function toBoolean(value: boolean | number | undefined, fallback: boolean): boolean {
  if (value == null) {
    return fallback
  }
  if (typeof value === 'boolean') {
    return value
  }
  return value !== 0
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
  _lastGoalCurrent: number
  _feedbackEnabled: boolean
  presentPosition: number
  constructor(
    servo: Dynamixel,
    gain: number,
    saturation: number,
    minCurrent: number,
    feedbackEnabled: boolean,
    name = 'servo',
  ) {
    this.servo = servo
    this.gain = gain
    this.saturation = saturation
    this.minCurrent = minCurrent
    this._feedbackEnabled = feedbackEnabled
    this.name = name
    this.goalPosition = 0
    this.presentPosition = 0
    this._offset = 0
    this._lastGoalPosition = -1
    this._lastGoalCurrent = -1
  }

  async init(torqueEnabled: boolean) {
    if (this._feedbackEnabled) {
      const initialPosition = await this.servo.readPresentPositionValue()
      if (initialPosition != null && initialPosition > 4096) {
        this._offset = 4096
      } else if (initialPosition == null) {
        trace(`${this.name} ... failed to read initial position for offset detection\n`)
      }
    }
    this.goalPosition = 2048
    this._lastGoalPosition = -1
    this._lastGoalCurrent = -1
    const mode = this._feedbackEnabled ? OPERATING_MODE.CURRENT_BASED_POSITION : OPERATING_MODE.POSITION
    await this.servo.setOperatingMode(mode)
    await this.servo.setTorque(torqueEnabled)
    if (!this._feedbackEnabled) {
      await this.servo.setGoalPosition(this.goalPosition)
      this._lastGoalPosition = this.goalPosition
      this.presentPosition = this.goalPosition
    }
  }

  async update() {
    if (this._lastGoalPosition !== this.goalPosition) {
      await this.servo.setGoalPosition(this.goalPosition + this._offset)
      this._lastGoalPosition = this.goalPosition
      if (!this._feedbackEnabled) {
        this.presentPosition = this.goalPosition
      }
    }
    if (!this._feedbackEnabled) {
      return
    }

    const position = await this.servo.readPresentPositionValue()
    if (position == null) {
      return
    }
    this.presentPosition = position - this._offset
    const positionError = Math.abs(this.goalPosition - this.presentPosition)
    const current = Math.min(Math.max(positionError * this.gain, this.minCurrent), this.saturation)
    const currentInt = current | 0
    if (this._lastGoalCurrent === currentInt) {
      return
    }
    await this.servo.setGoalCurrent(currentInt)
    this._lastGoalCurrent = currentInt
  }

  async flushGoalPosition(): Promise<void> {
    if (this._lastGoalPosition === this.goalPosition) {
      return
    }
    await this.servo.setGoalPosition(this.goalPosition + this._offset)
    this._lastGoalPosition = this.goalPosition
    this.presentPosition = this.goalPosition
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
  _feedback: boolean
  _feedbackLoopEnabled: boolean
  _interval: number
  _initPromise?: Promise<void>
  constructor(param: DynamixelDriverProps) {
    const baud = toPositiveInteger(param.baud, toPositiveInteger(param.baudrate, DEFAULT_BAUD))
    this._feedback = toBoolean(param.feedback, true)
    this._feedbackLoopEnabled = this._feedback
    this._pan = new Dynamixel({ id: param.panId, baudrate: baud })
    this._tilt = new Dynamixel({ id: param.tiltId, baudrate: baud })
    this._controls = [
      new PControl(this._pan, 1.0, 80, 40, this._feedback, 'pan'),
      new PControl(this._tilt, 4, 800, 0, this._feedback, 'tilt'),
    ]
    this._torque = true
    this._initialized = false
    this._running = false
    this._attached = false
    this._interval = toPositiveInteger(param.interval, DEFAULT_INTERVAL)
    this._initPromise = undefined
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
    if (!this._feedback || !this._feedbackLoopEnabled) {
      void this._ensureInitialized().catch((error) => {
        trace(`servo initialization failed: ${error}\n`)
      })
      return
    }
    this._scheduleNext(0)
  }

  onDetached(): void {
    this._attached = false
    if (this._nextTimer) {
      Timer.clear(this._nextTimer)
      this._nextTimer = undefined
    }
  }

  async _ensureInitialized(): Promise<void> {
    if (this._initialized) {
      return
    }
    if (this._initPromise) {
      await this._initPromise
      return
    }
    this._initPromise = (async () => {
      const initStatusReturnLevel: 0 | 1 = this._feedback ? 1 : 0
      await this._pan.setStatusReturnLevel(initStatusReturnLevel)
      await this._tilt.setStatusReturnLevel(initStatusReturnLevel)
      for (const c of this._controls) {
        await c.init(this._torque)
      }
      for (const c of this._controls) {
        await c.servo.setProfileAcceleration(20)
        await c.servo.setProfileVelocity(100)
      }
      const finalStatusReturnLevel: 0 | 1 = this._feedback && this._feedbackLoopEnabled ? 1 : 0
      if (finalStatusReturnLevel !== initStatusReturnLevel) {
        await this._pan.setStatusReturnLevel(finalStatusReturnLevel)
        await this._tilt.setStatusReturnLevel(finalStatusReturnLevel)
      }
      this._initialized = true
      trace('servo initialized\n')
    })()
    try {
      await this._initPromise
    } finally {
      this._initPromise = undefined
    }
  }

  _scheduleNext(delay: number): void {
    if (this._nextTimer || !this._attached || !this._feedback || !this._feedbackLoopEnabled) {
      return
    }
    this._nextTimer = Timer.set(() => {
      this._nextTimer = undefined
      void this.control().catch((error) => {
        trace(`servo control failed: ${error}\n`)
      })
    }, delay)
  }

  async control(): Promise<void> {
    if (this._running) {
      return
    }
    this._running = true
    const cycleStartedAt = Date.now()
    try {
      await this._ensureInitialized()
      if (!this._torque) {
        return
      }
      for (const c of this._controls) {
        await c.update()
      }
    } finally {
      this._running = false
      if (this._attached && this._feedback && this._feedbackLoopEnabled) {
        const elapsed = Date.now() - cycleStartedAt
        const delay = elapsed < this._interval ? this._interval - elapsed : 0
        this._scheduleNext(delay)
      }
    }
  }

  async setFeedbackLoopEnabled(enabled: boolean): Promise<void> {
    if (!this._feedback) {
      return
    }
    const next = Boolean(enabled)
    if (this._feedbackLoopEnabled === next) {
      return
    }
    this._feedbackLoopEnabled = next
    if (this._nextTimer) {
      Timer.clear(this._nextTimer)
      this._nextTimer = undefined
    }
    await this._ensureInitialized()
    const statusReturnLevel: 0 | 1 = this._feedbackLoopEnabled ? 1 : 0
    await this._pan.setStatusReturnLevel(statusReturnLevel)
    await this._tilt.setStatusReturnLevel(statusReturnLevel)
    if (this._attached && this._feedbackLoopEnabled && !this._running) {
      this._scheduleNext(0)
    }
  }

  async applyRotation(ori: Rotation): Promise<void> {
    const panAngle = (ori.y * 180) / Math.PI
    const tiltAngle = (ori.p * 180) / Math.PI
    this._controls[0].goalPosition = Math.floor(((panAngle + 180) * 4096) / 360)
    this._controls[1].goalPosition = Math.floor(((Math.min(Math.max(tiltAngle, -30), 10) + 180) * 4096) / 360)
    if (!this._feedback || !this._feedbackLoopEnabled) {
      await this._ensureInitialized()
      if (!this._torque) {
        return
      }
      await this._controls[0].flushGoalPosition()
      await this._controls[1].flushGoalPosition()
    }
  }

  async getRotation(): Promise<Maybe<Rotation>> {
    const p1 = (this._controls[0].presentPosition * 360) / 4096 - 180
    const p2 = (this._controls[1].presentPosition * 360) / 4096 - 180
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
