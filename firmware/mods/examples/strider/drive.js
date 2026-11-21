import { CalibrationGait, isTurnCenter, TurningGait } from 'strider-gait'

export const CONTROL_TICK_MS = 25
const COMMAND_LEASE_MS = 400
// A heartbeat can arrive during a UART read with a 120 ms timeout.
const HOST_WATCHDOG_RESERVE_MS = 150
const WALK_DIRECTION = { forward: 1, backward: -1 }

function parseCommand(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  const { action, gesture, power } = payload
  if (!Number.isSafeInteger(gesture) || gesture <= 0) return undefined
  if (action === 'stop' || action === 'calibrate' || action === 'left' || action === 'right') return { action, gesture }
  if (action !== 'forward' && action !== 'backward') return undefined
  if (!Number.isFinite(power) || power < 0.2 || power > 1) return undefined
  return { action, gesture, power }
}

export class StriderDrive {
  #ports
  #turnCenter
  #status
  #reason
  #stateGesture
  #lastGesture = 0
  #command
  #motion
  #task
  #stopPending
  #closed = false
  #stopFailed = false

  constructor(ports, turnCenter) {
    this.#ports = ports
    this.#turnCenter = isTurnCenter(turnCenter) ? turnCenter : undefined
    this.#status = this.#idleStatus()
  }

  #idleStatus() {
    return this.#turnCenter === undefined ? 'needs-calibration' : 'calibrated'
  }

  state() {
    return {
      status: this.#status,
      calibrated: this.#turnCenter !== undefined,
      ...(this.#reason !== undefined ? { reason: this.#reason } : {}),
      ...(this.#stateGesture !== undefined ? { gesture: this.#stateGesture } : {}),
    }
  }

  #publish(status, reason, gesture) {
    if (this.#status === status && this.#reason === reason && this.#stateGesture === gesture) return
    this.#status = status
    this.#reason = reason
    this.#stateGesture = gesture
    this.#ports.notify(this.state())
  }

  receive(payload) {
    if (this.#closed) return false
    this.#expire()
    const received = parseCommand(payload)
    if (!received || received.gesture < this.#lastGesture) return false
    if (received.action === 'stop') {
      this.#lastGesture = received.gesture
      this.#cancel()
      return true
    }
    if (this.#stopFailed) return false

    if (received.gesture === this.#lastGesture) {
      if (this.#command?.action !== received.action) return false
      this.#command.power = received.power
      this.#command.receivedAt = this.#ports.now()
      return true
    }

    this.#lastGesture = received.gesture
    this.#cancel()
    if ((received.action === 'left' || received.action === 'right') && this.#turnCenter === undefined) {
      this.#publish('needs-calibration')
      return false
    }
    if (received.action === 'calibrate' && !this.#ports.openGyro) {
      this.#publish('error', 'gyro-unavailable', received.gesture)
      return false
    }
    this.#command = { ...received, receivedAt: this.#ports.now() }
    return true
  }

  disconnect() {
    this.#lastGesture = 0
    this.#cancel()
  }

  async close() {
    this.#closed = true
    this.#cancel()
    await this.#task
    await this.#stopPending
  }

  #cancel() {
    const command = this.#command
    this.#command = undefined
    this.#releaseMotion()
    if (command?.action === 'calibrate' && this.#status === 'calibrating') {
      this.#publish(this.#idleStatus(), undefined, command.gesture)
    }
  }

  #releaseMotion() {
    if (this.#motion) {
      const { yaw, gyro } = this.#motion
      this.#motion = undefined
      this.#stopYaw(yaw)
      gyro?.close()
    }
  }

  #stopYaw(yaw) {
    this.#stopPending = yaw.close().catch((error) => {
      this.#stopFailed = true
      this.#command = undefined
      this.#ports.reportError(error)
      this.#publish('error', 'stop-failed')
    })
    return this.#stopPending
  }

  #remaining(command) {
    return COMMAND_LEASE_MS - this.#ports.elapsed(command.receivedAt)
  }

  #expire() {
    if (this.#command && this.#remaining(this.#command) <= 0) this.#cancel()
  }

  #current(command) {
    this.#expire()
    return this.#command === command
  }

  tick() {
    this.#expire()
    if (this.#task || !this.#command) return this.#task
    const command = this.#command
    this.#task = this.#step(command)
      .catch((error) => {
        if (this.#command !== command) return
        this.#cancel()
        this.#ports.reportError(error)
        this.#publish('error', 'drive-failed', command.gesture)
      })
      .finally(() => {
        this.#task = undefined
      })
    return this.#task
  }

  async #step(command) {
    await this.#stopPending
    if (!this.#current(command)) return
    const { action } = command
    if (!this.#motion) {
      const yaw = await this.#ports.startContinuousYaw()
      if (!this.#current(command)) {
        if (yaw) await this.#stopYaw(yaw)
        return
      }
      if (!yaw) {
        this.#cancel()
        this.#publish('error', 'motion-unavailable', command.gesture)
        return
      }
      const calibration = action === 'calibrate' ? new CalibrationGait() : undefined
      const turn = action === 'left' || action === 'right' ? new TurningGait(this.#turnCenter, action) : undefined
      this.#motion = { yaw, calibration, turn, gyro: undefined, startedAt: this.#ports.now(), applied: undefined }
      if (calibration) this.#motion.gyro = this.#ports.openGyro()
      if (calibration) this.#publish('calibrating', undefined, command.gesture)
      else this.#publish(this.#idleStatus())
    }

    const motion = this.#motion
    const { calibration, turn, yaw } = motion
    let power
    if (calibration || turn) {
      if (motion.applied && motion.applied.receivedAt !== command.receivedAt) {
        await this.#applyPower(command, motion, motion.applied.power)
        if (!this.#current(command)) return
      }
      const raw = turn || calibration?.needsSample ? await yaw.readRawPosition() : undefined
      if (!this.#current(command)) return
      if (raw !== undefined && (!Number.isInteger(raw) || raw < 0 || raw > 1023)) {
        throw new Error('Invalid K151 yaw position')
      }
      const elapsedMs = this.#ports.elapsed(motion.startedAt)
      if (calibration) {
        const gyro = calibration.needsSample ? motion.gyro.read() : undefined
        const result = calibration.advance(elapsedMs, raw, gyro)
        if (!('power' in result)) {
          await this.#finishCalibration(command, result.center)
          return
        }
        power = result.power
      } else {
        power = turn.advance(raw, elapsedMs)
      }
    } else {
      power = WALK_DIRECTION[action] * command.power
    }

    await this.#applyPower(command, motion, power)
  }

  async #applyPower(command, motion, power) {
    if (!this.#current(command)) return
    const { receivedAt } = command
    if (motion.applied?.power === power && motion.applied?.receivedAt === receivedAt) return
    const leaseMs = this.#remaining(command)
    if (leaseMs <= 0) {
      this.#cancel()
      return
    }
    await motion.yaw.setPower(power, leaseMs + HOST_WATCHDOG_RESERVE_MS)
    motion.applied = { power, receivedAt }
  }

  async #finishCalibration(command, center) {
    this.#releaseMotion()
    await this.#stopPending
    if (!this.#current(command)) return
    this.#command = undefined
    if (center === undefined) {
      this.#publish('error', 'calibration-failed', command.gesture)
      return
    }
    try {
      this.#ports.saveTurnCenter(center)
      this.#turnCenter = center
      this.#publish('calibrated', undefined, command.gesture)
    } catch (error) {
      this.#ports.reportError(error)
      this.#publish('error', 'calibration-save-failed', command.gesture)
    }
  }
}
