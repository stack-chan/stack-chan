import Serial from 'embedded:io/serial'
import config from 'mc/config'

import { ServoBusError, type ServoCommand, type ServoEndpoint, type ServoIdChange } from 'servo-bus'
import { getServoBuses } from 'servo-bus-runtime'

type Maybe<T> =
  | {
      success: true
      value: T
    }
  | {
      success: false
      reason?: string
    }

export type SCServoGoalTimeMilliseconds = number

// utilities
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}
function le(v: number): [number, number] {
  return [(v & 0xff00) >> 8, v & 0xff]
}
function el(h: number, l: number) {
  return ((h << 8) & 0xff00) + (l & 0xff)
}

// biome-ignore lint/correctness/noUnusedVariables: constant for future use
const BROADCAST_ID = 0xfe // 254
// biome-ignore lint/correctness/noUnusedVariables: constant for future use
const MAX_ID = 0xfc // 252
// biome-ignore lint/correctness/noUnusedVariables: constant for future use
const SCS_END = 0

const COMMAND = {
  RESPONSE: 0x00,
  // NOTE: Some servo returns response with command 0x01. Dunno why.
  RESPONSE_ALT: 0x01,
  WRITE: 0x03,
  READ: 0x02,
} as const
type Command = (typeof COMMAND)[keyof typeof COMMAND]

const ADDRESS = {
  ID: 5,
  OFFSET: 31,
  TORQUE_ENABLE: 40,
  GOAL_ACC: 41,
  GOAL_POSITION: 42,
  GOAL_TIME: 44,
  LOCK: 48,
  PRESENT_POSITION: 56,
} as const
type Address = (typeof ADDRESS)[keyof typeof ADDRESS]

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
  #count: number
  constructor(option, receive: (id: number, payload: Uint8Array) => void) {
    const onReadable = function (this: PacketHandler, byte: number) {
      if (this.#closed) return
      const rxBuf = this.#rxBuffer
      for (let b = 0; b < byte; b++) {
        // NOTE: We can safely read a number
        rxBuf[this.#idx++] = this.read() as number
        switch (this.#state) {
          case RX_STATE.SEEK:
            if (this.#idx === 1 && rxBuf[0] !== 0xff) this.#idx = 0
            if (this.#idx === 2) {
              if (rxBuf[1] === 0xff) this.#state = RX_STATE.HEAD
              else this.#idx = 0
            }
            break
          case RX_STATE.HEAD:
            if (this.#idx >= 4) {
              this.#count = rxBuf[3]
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
              const cs = checksum(rxBuf, this.#idx - 1) & 0xff
              const id = rxBuf[2]
              const command = rxBuf[4] as Command
              if (command === COMMAND.READ || command === COMMAND.WRITE) {
                // trace(`got echo.  ... ${rxBuf.subarray(0, this.#idx)} ignoring\n`)
              } else if (cs === rxBuf[this.#idx - 1]) {
                // trace(`got response for ${id}. triggering callback \n`)
                const payloadLength = this.#idx - 6
                this.#receive(id, rxBuf.slice(5, 5 + payloadLength))
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

/**
 * calculates checksum of the SCS packets
 * @param arr packet array except checksum
 * @returns checksum number
 */
function checksum(buffer: Uint8Array, length: number): number {
  let sum = 0
  for (let i = 2; i < length; i++) {
    sum += buffer[i]
  }
  const cs = ~(sum & 0xff)
  // trace(`>>>checksum is ${new Uint8Array([cs])[0]}: ${arr}\n`)
  return cs
}

type SCServoConstructorParam = {
  id: number
  awaitWriteResponse?: boolean
  serial?: Partial<{
    receive: number
    transmit: number
    baud: number
    port: number
  }>
}
type CommandCallback = (values: Uint8Array | undefined) => void
type ErrorCallback = (error: unknown) => void
type CompletionCallback = (error?: unknown) => void
type ResultCallback<T> = (result: Maybe<T>) => void
const COMMAND_TIMEOUT_MS = 120

function reasonFromError(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}

function failureFromError<T>(error: unknown): Maybe<T> {
  return {
    success: false,
    reason: reasonFromError(error),
  }
}

class SCServo {
  #endpoint: ServoEndpoint
  #txBuf = new Uint8Array(64)
  #offset = 0
  #awaitWriteResponse: boolean
  constructor({ id, awaitWriteResponse = true, serial: serialOverride }: SCServoConstructorParam) {
    this.#awaitWriteResponse = awaitWriteResponse
    const serial = serialOverride ?? config.serial ?? {}
    const settings = {
      port: serial.port ?? 2,
      receive: serial.receive ?? 16,
      transmit: serial.transmit ?? 17,
      baud: serial.baud ?? 1_000_000,
      protocol: 'scservo',
    }
    this.#endpoint = getServoBuses().acquire(settings, id, 252, (receive) => new PacketHandler(settings, receive))
  }
  close(): void {
    this.#endpoint.close()
  }
  teardown(): void {
    this.close()
  }
  get id(): number {
    return this.#endpoint.id
  }

  #command(
    command: Command,
    address: Address,
    onResult: CommandCallback,
    onError: ErrorCallback,
    ...values: number[]
  ): ServoCommand {
    return {
      timeoutMs: COMMAND_TIMEOUT_MS,
      waitForResponse: command === COMMAND.READ || this.#awaitWriteResponse,
      onResult,
      onError,
      encode: (id) => {
        if (values.length + 7 > this.#txBuf.length)
          throw new ServoBusError('INVALID_ARGUMENT', 'SCServo packet is too long')
        this.#txBuf[0] = 0xff
        this.#txBuf[1] = 0xff
        this.#txBuf[2] = id
        this.#txBuf[3] = values.length + 3
        this.#txBuf[4] = command
        this.#txBuf[5] = address
        let idx = 6
        for (const value of values) this.#txBuf[idx++] = value
        this.#txBuf[idx] = checksum(this.#txBuf, idx)
        return this.#txBuf.subarray(0, idx + 1)
      },
    }
  }

  #sendCommand(
    command: Command,
    address: Address,
    onResult: CommandCallback,
    onError: ErrorCallback,
    ...values: number[]
  ): boolean {
    return this.#endpoint.send(this.#command(command, address, onResult, onError, ...values))
  }

  #lock(callback?: CompletionCallback): void {
    this.#sendCommand(COMMAND.WRITE, ADDRESS.LOCK, () => callback?.(), callback ?? (() => {}), 1)
  }

  #unlock(callback?: CompletionCallback): void {
    this.#sendCommand(COMMAND.WRITE, ADDRESS.LOCK, () => callback?.(), callback ?? (() => {}), 0)
  }

  /**
   * reads offset angle
   * @note SCS series does not have zero position calibration function.
   *  The offset value should be handled by the application.
   */
  readOffsetAngle(callback: ResultCallback<number>): void {
    this.#sendCommand(
      COMMAND.READ,
      ADDRESS.OFFSET,
      (values) => {
        if (values == null || values.length < 2) {
          callback({
            success: false,
            reason: 'response corrupted',
          })
          return
        }
        const raw = el(values[0], values[1])
        const isCcw = (raw & 0x8000) !== 0
        let offset = raw & 0x7fff
        if (isCcw) {
          offset *= -1
        }
        callback({
          success: true,
          value: offset,
        })
      },
      (error) => callback(failureFromError(error)),
      2,
    )
  }

  /**
   * sets offset angle
   * @param angle offset angle (-2000 to 2000)
   */
  setOffsetAngle(angle: number, callback?: CompletionCallback): void {
    this.#offset = angle
    const isCcw = angle < 0
    const a = isCcw ? angle * -1 : angle
    const value = (Number(isCcw) << 15) | (a & 0x7fff)
    this.#sendCommand(COMMAND.WRITE, ADDRESS.OFFSET, () => callback?.(), callback ?? (() => {}), ...le(value))
  }

  /**
   * load settings from the servo
   */
  loadSettings(callback?: CompletionCallback): void {
    // Offset angle
    this.readOffsetAngle((result) => {
      if (result.success === false) {
        callback?.(result.reason ?? 'failed to read offset angle')
        return
      }
      this.#offset = result.value

      // Further configuration to be loaded below
      callback?.()
    })
  }

  /**
   * save settings to the servo
   */
  saveSettings(callback?: CompletionCallback): void {
    // Offset angle
    this.#unlock((unlockError) => {
      if (unlockError != null) {
        callback?.(unlockError)
        return
      }
      this.setOffsetAngle(this.#offset, (offsetError) => {
        if (offsetError != null) {
          callback?.(offsetError)
          return
        }
        this.#lock(callback)
      })
    })
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
        COMMAND.WRITE,
        ADDRESS.LOCK,
        () => {
          change.send(
            this.#command(
              COMMAND.WRITE,
              ADDRESS.ID,
              () => {
                change.commit()
                change.send(this.#command(COMMAND.WRITE, ADDRESS.LOCK, () => finish(), finish, 1))
              },
              finish,
              id,
            ),
          )
        },
        finish,
        0,
      ),
    )
  }

  /**
   * sets angle immediately
   * @param angle angle(degree)
   * @returns TBD
   */
  setAngle(angle: number, callback?: CompletionCallback): void {
    const a = Math.floor(clamp(((angle + this.#offset) * 1024) / 200, 0, 0x03ff))
    this.setRawPosition(a, callback)
  }

  /**
   * sets angle within goal time
   * @param angle angle(degree)
   * @param goalTimeMilliseconds time in milliseconds
   * @returns TBD
   */
  setAngleInTime(
    angle: number,
    goalTimeMilliseconds: SCServoGoalTimeMilliseconds,
    callback?: CompletionCallback,
  ): void {
    // 0 <= a <= 1023
    const a = Math.floor(clamp(((angle + this.#offset) * 1024) / 200, 0, 0x03ff))
    this.setRawPositionInTime(a, goalTimeMilliseconds, callback)
  }

  setRawPosition(rawPosition: number, callback?: CompletionCallback): void {
    const position = Math.floor(clamp(rawPosition, 0, 0x03ff))
    this.#sendCommand(COMMAND.WRITE, ADDRESS.GOAL_POSITION, () => callback?.(), callback ?? (() => {}), ...le(position))
  }

  setRawPositionInTime(
    rawPosition: number,
    goalTimeMilliseconds: SCServoGoalTimeMilliseconds,
    callback?: CompletionCallback,
  ): void {
    const position = Math.floor(clamp(rawPosition, 0, 0x03ff))
    this.#sendCommand(
      COMMAND.WRITE,
      ADDRESS.GOAL_POSITION,
      () => callback?.(),
      callback ?? (() => {}),
      ...le(position),
      ...le(goalTimeMilliseconds),
    )
  }

  readRawPosition(callback: ResultCallback<{ position: number }>): void {
    this.#sendCommand(
      COMMAND.READ,
      ADDRESS.PRESENT_POSITION,
      (values) => {
        if (values == null || values.length < 2) {
          callback({
            success: false,
            reason: 'response corrupted.',
          })
          return
        }
        callback({
          success: true,
          value: { position: el(values[0], values[1]) },
        })
      },
      (error) => callback(failureFromError(error)),
      2,
    )
  }

  /**
   * sets torque
   * @param enable enable
   * @returns TBD
   */
  setTorque(enable: boolean, callback?: CompletionCallback): void {
    this.#sendCommand(COMMAND.WRITE, ADDRESS.TORQUE_ENABLE, () => callback?.(), callback ?? (() => {}), Number(enable))
  }

  /**
   * reads servo's present status
   * @returns angle(degree)
   */
  readStatus(callback: ResultCallback<{ angle: number }>): void {
    this.readRawPosition((raw) => {
      if (raw.success === false) {
        callback({
          success: false,
          reason: raw.reason,
        })
        return
      }
      const angle = (raw.value.position * 200) / 1024 - this.#offset
      callback({
        success: true,
        value: { angle },
      })
    })
  }
}

export default SCServo
