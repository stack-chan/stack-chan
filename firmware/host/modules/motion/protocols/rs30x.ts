import Serial from 'embedded:io/serial'
import config from 'mc/config'

import { ServoBusError, type ServoCommand, type ServoEndpoint, type ServoIdChange } from 'servo-bus'
import { getServoBuses } from 'servo-bus-runtime'

// type aliases
type TORQUE_OFF = 0
type TORQUE_ON = 1
type TORQUE_BREAK = 2
type TorqueMode = TORQUE_OFF | TORQUE_ON | TORQUE_BREAK

export const TorqueMode: { [key: string]: TorqueMode } = Object.freeze({
  OFF: 0,
  ON: 1,
  BREAK: 2,
})
export const Rotation = Object.freeze({
  CW: 0,
  CCW: 1,
})
export type Rotation = (typeof Rotation)[keyof typeof Rotation]
export type RS30XGoalTimeCentiseconds = number

// constants
const COMMANDS = Object.freeze({
  START: Object.freeze([0xfa, 0xaf]),
  FLASH: Object.freeze([0x40, 0xff, 0x00, 0x00]),
  SET_ANGLE: Object.freeze([0x03, 0x1e, 0x02, 0x01]),
  SET_ANGLE_IN_TIME: Object.freeze([0x03, 0x1e, 0x04, 0x01]),
  SET_MAX_ANGLE: [],
  SET_TORQUE: Object.freeze([0x03, 0x24, 0x01, 0x01]),
  SET_SERVO_ID: Object.freeze([0x03, 0x04, 0x01, 0x01]),
  SET_MAX_TORQUE: Object.freeze([0x03, 0x23, 0x01, 0x01]),
  SET_COMPLIANCE_SLOPE_CW: Object.freeze([0x03, 0x1a, 0x01, 0x01]),
  SET_COMPLIANCE_SLOPE_CCW: Object.freeze([0x03, 0x1b, 0x01, 0x01]),
  SET_DELAY: Object.freeze([0x03, 0x07, 0x01, 0x01]),
  REQUEST_STATUS: Object.freeze([0x09, 0x00, 0x00, 0x01]),
  REBOOT: Object.freeze([0x20, 0xff, 0x00, 0x00]),
  SET_ANGLES: Object.freeze([0x00, 0x1e, 0x03]),
  SET_ANGLES_IN_TIME: Object.freeze([0x00, 0x1e, 0x05]),
} as const)

const PACKET_TYPE = {
  COMMAND: 0xfaaf,
  RESPONSE: 0xfddf,
} as const

// utilities
// biome-ignore lint/correctness/noUnusedVariables: utility function for future use
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}
function be(v: number): [number, number] {
  return [v & 0xff, (v & 0xff00) >> 8]
}
function eb(l: number, h: number) {
  return ((h << 8) & 0xff00) + (l & 0xff)
}
// biome-ignore lint/correctness/noUnusedVariables: utility function for future use
function le(v: number): [number, number] {
  return [(v & 0xff00) >> 8, v & 0xff]
}
function el(h: number, l: number) {
  return ((h << 8) & 0xff00) + (l & 0xff)
}

/**
 * calculates checksum of the SCS packets
 * @param arr packet array except checksum
 * @returns checksum number
 */
// file local methods
function checksum(buffer: Uint8Array, start: number, end: number): number {
  let sum = 0
  for (let i = start; i < end; i++) {
    sum ^= buffer[i]
  }
  return sum
}

const RX_STATE = {
  SEEK: 0,
  HEAD: 1,
  BODY: 2,
} as const
type RxState = (typeof RX_STATE)[keyof typeof RX_STATE]

function assertNeverRxState(state: never): never {
  throw new Error(`Unknown RX state: ${state}`)
}

class PacketHandler extends Serial {
  #receive: (id: number, payload: Uint8Array) => void
  #closed = false
  #rxBuffer: Uint8Array
  #idx: number
  #state: RxState
  #count = 0
  constructor(option, receive: (id: number, payload: Uint8Array) => void) {
    const onReadable = function (this: PacketHandler, bytes: number) {
      if (this.#closed) return
      const rxBuf = this.#rxBuffer
      for (let b = 0; b < bytes; b++) {
        // NOTE: We can safely read a number
        rxBuf[this.#idx++] = this.read() as number
        switch (this.#state) {
          case RX_STATE.SEEK:
            if (this.#idx === 1 && rxBuf[0] !== 0xfa && rxBuf[0] !== 0xfd) this.#idx = 0
            if (this.#idx === 2) {
              const header = el(rxBuf[0], rxBuf[1])
              if (header === PACKET_TYPE.COMMAND || header === PACKET_TYPE.RESPONSE) this.#state = RX_STATE.HEAD
              else if (rxBuf[1] === 0xfa || rxBuf[1] === 0xfd) {
                rxBuf[0] = rxBuf[1]
                this.#idx = 1
              } else this.#idx = 0
            }
            break
          case RX_STATE.HEAD:
            if (this.#idx >= 6) {
              this.#count = rxBuf[5] + 2
              if (this.#count < 2 || this.#idx + this.#count > rxBuf.length) {
                this.#idx = 0
                this.#state = RX_STATE.SEEK
                break
              }
              this.#state = RX_STATE.BODY
            }
            break
          case RX_STATE.BODY:
            this.#count -= 1
            if (this.#count === 0) {
              // trace('received packet!\n')
              const cs = checksum(rxBuf, 2, this.#idx - 1) & 0xff
              const id = rxBuf[2]
              const header = el(rxBuf[0], rxBuf[1])
              if (header === PACKET_TYPE.COMMAND) {
                // trace(`got echo.  ... ${rxBuf.subarray(0, this.#idx)} ignoring\n`)
              } else if (cs === rxBuf[this.#idx - 1]) {
                // trace(`got response for ${id}. triggering callback \n`)
                const payloadLength = this.#idx - 8
                this.#receive(id, rxBuf.slice(7, 7 + payloadLength))
              } else {
                trace(`unknown packet for ${id} ... ${rxBuf.subarray(0, this.#idx)}. ignoring\n`)
              }
              this.#idx = 0
              this.#state = RX_STATE.SEEK
            }
            break
          default: {
            assertNeverRxState(this.#state)
          }
        }
        // noop
      }
    }
    const rxBuffer = new Uint8Array(64)
    super({
      ...option,
      format: 'number',
      onReadable,
    })
    this.#receive = receive
    this.#rxBuffer = rxBuffer
    this.#idx = 0
    this.#state = RX_STATE.SEEK
  }
  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#receive = undefined
    this.#idx = 0
    super.close()
  }
}

type RS30XConstructorParam = {
  id: number
}
type CommandCallback = (values: Uint8Array | undefined) => void
type ErrorCallback = (error: unknown) => void
type CompletionCallback = (error?: unknown) => void
type ValueCallback<T> = (value: T | undefined, error?: unknown) => void
const COMMAND_TIMEOUT_MS = 100

class RS30X {
  #endpoint: ServoEndpoint
  #txBuf = new Uint8Array(64)
  constructor({ id }: RS30XConstructorParam) {
    const settings = {
      receive: config.serial?.receive ?? 16,
      transmit: config.serial?.transmit ?? 17,
      baud: 115_200,
      port: 2,
      protocol: 'rs30x',
    }
    this.#endpoint = getServoBuses().acquire(settings, id, 127, (receive) => new PacketHandler(settings, receive))
  }
  close(): void {
    this.#endpoint.close()
  }
  teardown(): void {
    this.close()
  }
  set id(_: number) {
    throw new Error('cannot set id of single servo. Use "flashId" function')
  }
  get id(): number {
    return this.#endpoint.id
  }

  #command(onResult: CommandCallback, onError: ErrorCallback, ...values: number[]): ServoCommand {
    return {
      timeoutMs: COMMAND_TIMEOUT_MS,
      onResult,
      onError,
      encode: (id) => {
        if (values.length + 4 > this.#txBuf.length)
          throw new ServoBusError('INVALID_ARGUMENT', 'RS30X packet is too long')
        this.#txBuf[0] = 0xfa
        this.#txBuf[1] = 0xaf
        this.#txBuf[2] = id
        let idx = 3
        for (const value of values) this.#txBuf[idx++] = value
        this.#txBuf[idx] = checksum(this.#txBuf, 2, idx)
        return this.#txBuf.subarray(0, idx + 1)
      },
    }
  }

  #sendCommand(onResult: CommandCallback, onError: ErrorCallback, ...values: number[]): boolean {
    return this.#endpoint.send(this.#command(onResult, onError, ...values))
  }

  setMaxTorque(maxTorque: number, callback?: CompletionCallback): void {
    this.#sendCommand(
      () => {
        this.#sendCommand(() => callback?.(), callback ?? (() => {}), ...COMMANDS.FLASH)
      },
      callback ?? (() => {}),
      ...COMMANDS.SET_MAX_TORQUE,
      maxTorque,
    )
  }

  flashId(id: number, callback?: CompletionCallback): void {
    let change: ServoIdChange
    try {
      change = this.#endpoint.beginIdChange(id)
    } catch (error) {
      callback?.(error)
      return
    }
    const finish = (error?: unknown) => {
      change.close()
      callback?.(error)
    }
    change.send(
      this.#command(
        () => {
          change.commit()
          change.send(this.#command(() => finish(), finish, ...COMMANDS.FLASH))
        },
        finish,
        ...COMMANDS.SET_SERVO_ID,
        id,
      ),
    )
  }

  /**
   * sets angle immediately
   * @param angle angle(degree)
   * @returns TBD
   */
  setAngle(angle: number, callback?: CompletionCallback): void {
    const a = Math.max(-150, Math.min(150, angle)) * 10
    this.#sendCommand(() => callback?.(), callback ?? (() => {}), ...COMMANDS.SET_ANGLE, ...be(a))
  }

  /**
   * sets angle within goal time
   * @param angle angle(degree)
   * @param goalTimeCentiseconds time in 10ms units
   * @returns TBD
   */
  setAngleInTime(angle: number, goalTimeCentiseconds: RS30XGoalTimeCentiseconds, callback?: CompletionCallback): void {
    const a = Math.max(-150, Math.min(150, angle)) * 10
    this.#sendCommand(
      () => callback?.(),
      callback ?? (() => {}),
      ...COMMANDS.SET_ANGLE_IN_TIME,
      ...be(a),
      ...be(goalTimeCentiseconds),
    )
  }

  setComplianceSlope(rotation: Rotation, angle: number, callback?: CompletionCallback): void {
    const command = rotation === Rotation.CW ? COMMANDS.SET_COMPLIANCE_SLOPE_CW : COMMANDS.SET_COMPLIANCE_SLOPE_CCW
    this.#sendCommand(() => callback?.(), callback ?? (() => {}), ...command, angle)
  }

  reboot(callback?: CompletionCallback): void {
    this.#sendCommand(() => callback?.(), callback ?? (() => {}), ...COMMANDS.REBOOT)
  }

  /**
   * sets torque
   * @param enable enable
   * @returns TBD
   */
  setTorque(enable: boolean, callback?: CompletionCallback): void {
    const mode = enable ? TorqueMode.ON : TorqueMode.OFF
    this.#sendCommand(() => callback?.(), callback ?? (() => {}), ...COMMANDS.SET_TORQUE, mode)
  }

  /**
   * reads servo's present status
   * @returns angle(degree)
   */
  readStatus(callback: ValueCallback<number>): void {
    this.#sendCommand(
      (values) => {
        if (values == null || values.length < 18) {
          callback(undefined, new Error('response corrupted'))
          return
        }
        const angle = eb(values[0], values[1])
        if (angle >= 65535 / 2) {
          callback((angle - 65536) / 10)
          return
        }
        callback(angle / 10)
      },
      (error) => callback(undefined, error),
      ...COMMANDS.REQUEST_STATUS,
    )
  }
}

export default RS30X
