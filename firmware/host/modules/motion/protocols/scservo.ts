import Serial from 'embedded:io/serial'
import config from 'mc/config'
import { PayloadBuffer } from 'payload-buffer'

import SingleWaitSlot from 'single-wait-slot'
import Timer from 'timer'

type Maybe<T> =
  | {
      success: true
      value: T
    }
  | {
      success: false
      reason?: string
    }

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
  #callbacks: Map<number, (buffer: Uint8Array, length: number) => void>
  #rxBuffer: Uint8Array
  #payloadBuffer: PayloadBuffer
  #idx: number
  #state: RxState
  #count: number
  constructor(option) {
    const onReadable = function (this: PacketHandler, byte: number) {
      const rxBuf = this.#rxBuffer
      for (let b = 0; b < byte; b++) {
        // NOTE: We can safely read a number
        rxBuf[this.#idx++] = this.read() as number
        switch (this.#state) {
          case RX_STATE.SEEK:
            if (this.#idx >= 2) {
              // see header
              if (rxBuf[0] === 0xff && rxBuf[1] === 0xff) {
                // packet found
                this.#state = RX_STATE.HEAD
              } else {
                // reset seek
                // trace('seeking failed. reset\n')
                this.#idx = 0
              }
            }
            break
          case RX_STATE.HEAD:
            if (this.#idx >= 4) {
              this.#count = rxBuf[3]
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
              } else if (cs === rxBuf[this.#idx - 1] && this.#callbacks.has(id)) {
                // trace(`got response for ${id}. triggering callback \n`)
                const payloadLength = this.#idx - 6
                const payloadView = this.#payloadBuffer.copyFrom(rxBuf, payloadLength, 5)
                const payload = new Uint8Array(payloadLength)
                payload.set(payloadView.subarray(0, payloadLength))
                this.#callbacks.get(id)(payload, payloadLength)
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
    super({
      ...option,
      format: 'number',
      onReadable,
    })
    this.#callbacks = new Map<number, (buffer: Uint8Array, length: number) => void>()
    this.#rxBuffer = new Uint8Array(64)
    this.#payloadBuffer = new PayloadBuffer(32)
    this.#idx = 0
    this.#state = RX_STATE.SEEK
  }
  hasCallbackOf(id: number): boolean {
    return this.#callbacks.has(id)
  }
  registerCallback(id: number, callback: (buffer: Uint8Array, length: number) => void) {
    this.#callbacks.set(id, callback)
  }
  removeCallback(id: number) {
    this.#callbacks.delete(id)
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

let packetHandler: PacketHandler = null
let packetHandlerSerialKey: string | null = null
class SCServo {
  #id: number
  #onCommandRead: (buffer: Uint8Array, length: number) => void
  #txBuf: Uint8Array
  #waitSlot: SingleWaitSlot<Uint8Array>
  #offset: number
  #awaitWriteResponse: boolean
  #isWriting = false
  constructor({ id, awaitWriteResponse = true, serial: serialOverride }: SCServoConstructorParam) {
    this.#id = id
    this.#waitSlot = new SingleWaitSlot<Uint8Array>(Timer.set, Timer.clear)
    this.#offset = 0
    this.#awaitWriteResponse = awaitWriteResponse
    this.#onCommandRead = (values, _length) => {
      this.#waitSlot.resolve(values)
    }
    this.#txBuf = new Uint8Array(64)
    const serial = serialOverride ?? config.serial ?? {}
    const port = serial.port ?? 2
    const receive = serial.receive ?? 16
    const transmit = serial.transmit ?? 17
    const baud = serial.baud ?? 1_000_000
    const serialKey = `${port}:${transmit}:${receive}:${baud}`
    if (packetHandler == null) {
      trace(`[scservo] serial port=${port} tx=${transmit} rx=${receive} baud=${baud}\n`)
      packetHandler = new PacketHandler({
        receive,
        transmit,
        baud,
        port,
      })
      packetHandlerSerialKey = serialKey
    } else if (packetHandlerSerialKey !== serialKey) {
      throw new Error(
        `SCServo PacketHandler serial config mismatch: existing=${packetHandlerSerialKey}, requested=${serialKey}`,
      )
    }
    if (packetHandler.hasCallbackOf(id)) {
      throw new Error('This id is already instantiated')
    }
    packetHandler.registerCallback(this.#id, this.#onCommandRead)
  }
  teardown(): void {
    packetHandler.removeCallback(this.#id)
  }
  get id(): number {
    return this.#id
  }

  #dispatchCommand(
    command: Command,
    address: Address,
    onResult: CommandCallback,
    onError: ErrorCallback,
    ...values: number[]
  ): void {
    const waitsForResponse = command === COMMAND.READ || this.#awaitWriteResponse
    if (this.#isWriting || (waitsForResponse && this.#waitSlot.isWaiting)) {
      throw new Error('command is already waiting for response')
    }
    this.#isWriting = true
    this.#txBuf[0] = 0xff
    this.#txBuf[1] = 0xff
    this.#txBuf[2] = this.#id
    this.#txBuf[3] = values.length + 3
    this.#txBuf[4] = command // write or read
    this.#txBuf[5] = address
    let idx = 6
    for (const v of values) {
      this.#txBuf[idx] = v
      idx++
    }
    this.#txBuf[idx] = checksum(this.#txBuf, idx)
    idx++
    // trace(`writing: ${this.#txBuf.subarray(0, idx)}\n`)
    this.#writePacket(
      idx,
      () => {
        this.#isWriting = false
        if (!waitsForResponse) {
          onResult(undefined)
          return
        }
        this.#waitSlot.wait(40, onResult, () => {
          trace('timeout.\n')
        })
      },
      (error) => {
        this.#isWriting = false
        onError(error)
      },
    )
  }

  #writePacket(length: number, onWritten: () => void, onError: ErrorCallback, attempt = 0): void {
    const originalFormat = packetHandler.format
    let written = false
    packetHandler.format = 'buffer'
    try {
      packetHandler.write(this.#txBuf.subarray(0, length))
      written = true
    } catch (error) {
      if (attempt >= 1) {
        onError(error)
      } else {
        Timer.set(() => this.#writePacket(length, onWritten, onError, attempt + 1), 1)
      }
    } finally {
      packetHandler.format = originalFormat
    }
    if (!written) {
      return
    }
    try {
      onWritten()
    } catch (error) {
      onError(error)
    }
  }

  #sendCommand(
    command: Command,
    address: Address,
    onResult: CommandCallback,
    onError: ErrorCallback,
    ...values: number[]
  ): boolean {
    try {
      this.#dispatchCommand(command, address, onResult, onError, ...values)
      return true
    } catch (error) {
      onError(error)
      return false
    }
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
    if (packetHandler.hasCallbackOf(id)) {
      callback?.(new Error(`id(${id}) is already used\n`))
      return
    }
    // trace('unlocking\n')
    this.#unlock((unlockError) => {
      if (unlockError != null) {
        callback?.(unlockError)
        return
      }
      // trace('setting new id\n')
      const oldId = this.#id
      if (
        !this.#sendCommand(
          COMMAND.WRITE,
          ADDRESS.ID,
          () => {
            this.#lock((lockError) => {
              if (lockError != null) {
                callback?.(lockError)
                return
              }
              packetHandler.removeCallback(oldId)
              callback?.()
            })
          },
          callback ?? (() => {}),
          id,
        )
      ) {
        return
      }
      this.#id = id
      packetHandler.registerCallback(this.#id, this.#onCommandRead)
      // trace(`now we use new id(${id}\n`)
    })
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
   * @param goalTime time(millisecond)
   * @returns TBD
   */
  setAngleInTime(angle: number, goalTime: number, callback?: CompletionCallback): void {
    // 0 <= a <= 1023
    const a = Math.floor(clamp(((angle + this.#offset) * 1024) / 200, 0, 0x03ff))
    this.setRawPositionInTime(a, goalTime, callback)
  }

  setRawPosition(rawPosition: number, callback?: CompletionCallback): void {
    const position = Math.floor(clamp(rawPosition, 0, 0x03ff))
    this.#sendCommand(COMMAND.WRITE, ADDRESS.GOAL_POSITION, () => callback?.(), callback ?? (() => {}), ...le(position))
  }

  setRawPositionInTime(rawPosition: number, goalTime: number, callback?: CompletionCallback): void {
    const position = Math.floor(clamp(rawPosition, 0, 0x03ff))
    this.#sendCommand(
      COMMAND.WRITE,
      ADDRESS.GOAL_POSITION,
      () => callback?.(),
      callback ?? (() => {}),
      ...le(position),
      ...le(goalTime),
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
