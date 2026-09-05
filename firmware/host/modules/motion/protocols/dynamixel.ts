import Serial from 'embedded:io/serial'
import config from 'mc/config'
import {
  angleToDynamixelPosition,
  dynamixelCrc16,
  dynamixelPositionToAngle,
  dynamixelStatusPayloadHasData,
  int16FromDynamixelPayload,
  int32FromDynamixelPayload,
  int32ToDynamixelBytes,
  stuffDynamixelPacket,
  unstuffDynamixelPayload,
  verifyDynamixelPacketCrc,
} from 'protocols/dynamixel-codec'
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

function el(h: number, l: number) {
  return ((h << 8) & 0xff00) + (l & 0xff)
}

const INSTRUCTION = {
  PING: 0x01,
  READ: 0x02,
  WRITE: 0x03,
  REG_WRITE: 0x04,
  ACTION: 0x05,
  FACTORY_RESET: 0x06,
  REBOOT: 0x08,
  STATUS: 0x55,
  SYNC_READ: 0x82,
  SYNC_WRITE: 0x83,
  BULK_READ: 0x92,
  BULK_WRITE: 0x93,
} as const
type Instruction = (typeof INSTRUCTION)[keyof typeof INSTRUCTION]

export const BAUDRATE = {
  BAUD_9600: 0x00,
  BAUD_57600: 0x01,
  BAUD_115200: 0x02,
  BAUD_1000000: 0x03,
  BAUD_2000000: 0x04,
} as const
type Baudrate = (typeof BAUDRATE)[keyof typeof BAUDRATE]

export const OPERATING_MODE = {
  CURRENT: 0x00,
  VELOCITY: 0x01,
  POSITION: 0x03,
  EXTENDED_POSITION: 0x04,
  CURRENT_BASED_POSITION: 0x05,
  PWM: 0x10,
} as const
type OperatingMode = (typeof OPERATING_MODE)[keyof typeof OPERATING_MODE]

const ADDRESS = {
  MODEL_NUMBER: 0,
  MODEL_INFORMATION: 2,
  VERSION_OF_FIRMWARE: 6,
  ID: 7,
  BAUDRATE: 8,
  RETURN_DELAY_TIME: 9,
  DRIVE_MODE: 10,
  OPERATING_MODE: 11,
  HOMING_OFFSET: 20,
  TORQUE_ENABLE: 64,
  LED: 65,
  GOAL_CURRENT: 102,
  GOAL_POSITION: 116,
  PROFILE_ACCELERATION: 108,
  PROFILE_VELOCITY: 112,
  PRESENT_CURRENT: 126,
  PRESENT_VELOCITY: 128,
  PRESENT_POSITION: 132,
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
    const onReadable = function (this: PacketHandler, bytesReadable: number) {
      if (this.#closed) return
      const rxBuf = this.#rxBuffer
      let bytes = bytesReadable
      while (bytes > 0) {
        // NOTE: We can safely read a number
        rxBuf[this.#idx++] = this.read() as number
        bytes -= 1
        switch (this.#state) {
          case RX_STATE.SEEK:
            if (this.#idx === 1 && rxBuf[0] !== 0xff) this.#idx = 0
            if (this.#idx === 2 && rxBuf[1] !== 0xff) this.#idx = 0
            if (this.#idx === 3) {
              if (rxBuf[2] === 0xfd) this.#state = RX_STATE.HEAD
              else this.#idx = rxBuf[2] === 0xff ? 2 : 0
            }
            break
          case RX_STATE.HEAD:
            if (this.#idx >= 7) {
              this.#count = (rxBuf[6] << 8) | rxBuf[5]
              if (rxBuf[3] !== 0 || this.#count < 4 || this.#idx + this.#count > rxBuf.length) {
                this.#idx = 0
                this.#state = RX_STATE.SEEK
                break
              }
              this.#state = RX_STATE.BODY
              // trace(`length: ${this.#count}\n`)
            }
            break
          case RX_STATE.BODY:
            this.#count -= 1
            if (this.#count === 0) {
              const id = rxBuf[4]
              const command = rxBuf[7] as Instruction
              if (command === INSTRUCTION.WRITE || command === INSTRUCTION.READ) {
                // trace(`got echo.  ... ${rxBuf.subarray(0, this.#idx)} ignoring\n`)
              } else if (!verifyDynamixelPacketCrc(rxBuf, this.#idx)) {
                // A corrupted packet cannot complete the pending transaction.
                trace(`[dynamixel] crc mismatch for id=${id}. discarding ${rxBuf.subarray(0, this.#idx)}\n`)
              } else if (command === INSTRUCTION.STATUS) {
                // trace(`got response for ${id}. triggering callback ... ${rxBuf.subarray(0, this.#idx)} \n`)
                const payloadEnd = unstuffDynamixelPayload(rxBuf, this.#idx)
                this.#receive(id, rxBuf.slice(7, payloadEnd))
              }
              this.#idx = 0
              this.#state = RX_STATE.SEEK
            }
            break
          default:
            assertNeverRxState(this.#state)
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

type DynamixelSerialConfig = Partial<{
  receive: number
  transmit: number
  port: number
  baud: number
}>
type DynamixelConstructorParam = {
  id: number
  baudrate?: number
  commandTimeoutMs?: number
  serial?: DynamixelSerialConfig
}
type CommandCallback = (values: Uint8Array | undefined) => void
type ErrorCallback = (error: unknown) => void
type CompletionCallback = (error?: unknown) => void
type ValueCallback<T> = (value: T | undefined, error?: unknown) => void
const DEFAULT_COMMAND_TIMEOUT_MS = 200

function reasonFromError(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}

function maybeFailure<T>(error?: unknown): Maybe<T> {
  return {
    success: false,
    reason: error === undefined ? undefined : reasonFromError(error),
  }
}

let defaultBaud = 1_000_000

class Dynamixel {
  static setBaud(baud: number): void {
    if (!Number.isInteger(baud) || baud <= 0)
      throw new ServoBusError('INVALID_ARGUMENT', 'baud must be a positive integer')
    getServoBuses().assertUnused(1)
    defaultBaud = baud
  }
  #endpoint: ServoEndpoint
  #txBuf = new Uint8Array(64)
  #commandTimeoutMs: number
  constructor({
    id,
    baudrate = defaultBaud,
    commandTimeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
    serial,
  }: DynamixelConstructorParam) {
    if (!Number.isInteger(commandTimeoutMs) || commandTimeoutMs <= 0 || commandTimeoutMs > 60_000) {
      throw new ServoBusError('INVALID_ARGUMENT', 'commandTimeoutMs must be an integer in 1..60000')
    }
    this.#commandTimeoutMs = commandTimeoutMs
    const settings = {
      receive: serial?.receive ?? config.serial?.receive ?? 6,
      transmit: serial?.transmit ?? config.serial?.transmit ?? 7,
      port: serial?.port ?? 1,
      baud: serial?.baud ?? baudrate,
      protocol: 'dynamixel',
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
    instruction: Instruction,
    address: Address | undefined,
    onResult: CommandCallback,
    onError: ErrorCallback,
    ...parameters: number[]
  ): ServoCommand {
    return {
      timeoutMs: this.#commandTimeoutMs,
      onResult: (payload) => {
        if (!payload || payload.length < 2 || payload[1] !== 0) {
          onError(new ServoBusError('IO', `Dynamixel returned status error ${payload?.[1]}`))
          return
        }
        onResult(payload)
      },
      onError,
      encode: (id) => {
        if (parameters.length + 14 > this.#txBuf.length)
          throw new ServoBusError('INVALID_ARGUMENT', 'Dynamixel packet is too long')
        this.#txBuf[0] = 0xff
        this.#txBuf[1] = 0xff
        this.#txBuf[2] = 0xfd
        this.#txBuf[3] = 0x00
        this.#txBuf[4] = id
        this.#txBuf[7] = instruction
        let idx = 8
        if (address != null) {
          this.#txBuf[idx++] = address & 0xff
          this.#txBuf[idx++] = (address >> 8) & 0xff
        }
        if (instruction === INSTRUCTION.READ) {
          const count = parameters[0] ?? 1
          this.#txBuf[idx++] = count & 0xff
          this.#txBuf[idx++] = (count >> 8) & 0xff
        } else {
          for (const value of parameters) this.#txBuf[idx++] = value
        }
        idx = stuffDynamixelPacket(this.#txBuf, idx)
        const length = idx - 5
        this.#txBuf[5] = length & 0xff
        this.#txBuf[6] = (length >> 8) & 0xff
        const crc = dynamixelCrc16(this.#txBuf, 0, idx)
        this.#txBuf[idx++] = crc & 0xff
        this.#txBuf[idx++] = (crc >> 8) & 0xff
        return this.#txBuf.subarray(0, idx)
      },
    }
  }

  #sendCommand(
    instruction: Instruction,
    address: Address | undefined,
    onResult: CommandCallback,
    onError: ErrorCallback,
    ...parameters: number[]
  ): boolean {
    return this.#endpoint.send(this.#command(instruction, address, onResult, onError, ...parameters))
  }

  /**
   * resets values to factory default
   */
  factoryReset(callback?: CompletionCallback): void {
    this.#sendCommand(
      INSTRUCTION.FACTORY_RESET,
      null,
      () => callback?.(),
      callback ?? (() => {}),
      0x02 /* reset values except id and baudrate */,
    )
  }

  /**
   * reboots servo
   */
  reboot(callback?: CompletionCallback): void {
    this.#sendCommand(INSTRUCTION.REBOOT, undefined, () => callback?.(), callback ?? (() => {}))
  }

  /**
   * sets operating mode
   * @param mode - operating mode
   * @see https://emanual.robotis.com/docs/en/dxl/x/xl330-m288/#operating-mode
   */
  setOperatingMode(mode: OperatingMode, callback?: CompletionCallback): void {
    this.setTorque(false, (torqueError) => {
      if (torqueError != null) {
        callback?.(torqueError)
        return
      }
      this.#sendCommand(INSTRUCTION.WRITE, ADDRESS.OPERATING_MODE, () => callback?.(), callback ?? (() => {}), mode)
    })
  }

  /**
   * sets baudrate
   * @param baudrate - baudrate(bps)
   */
  setBaudrate(baudrate: Baudrate, callback?: CompletionCallback): void {
    this.setTorque(false, (torqueError) => {
      if (torqueError != null) {
        callback?.(torqueError)
        return
      }
      this.#sendCommand(INSTRUCTION.WRITE, ADDRESS.BAUDRATE, () => callback?.(), callback ?? (() => {}), baudrate)
    })
  }

  /**
   * sets profile acceleration
   * @param accel - profile acceleration
   */
  setProfileAcceleration(accel: number, callback?: CompletionCallback): void {
    this.#sendCommand(
      INSTRUCTION.WRITE,
      ADDRESS.PROFILE_ACCELERATION,
      () => callback?.(),
      callback ?? (() => {}),
      ...int32ToDynamixelBytes(accel),
    )
  }

  /**
   * sets profile velocity
   * Velocity [rpm] = Value * 0.229 [rpm]
   * @param velocity - goal velocity (ma)
   */
  setProfileVelocity(velocity: number, callback?: CompletionCallback): void {
    this.#sendCommand(
      INSTRUCTION.WRITE,
      ADDRESS.PROFILE_VELOCITY,
      () => callback?.(),
      callback ?? (() => {}),
      ...int32ToDynamixelBytes(velocity),
    )
  }

  /**
   * sets goal current
   * @param position - goal current (ma)
   */
  setGoalCurrent(current: number, callback?: CompletionCallback): void {
    const a = current & 0xff
    const b = (current >> 8) & 0xff
    this.#sendCommand(INSTRUCTION.WRITE, ADDRESS.GOAL_CURRENT, () => callback?.(), callback ?? (() => {}), a, b)
  }

  /**
   * sets goal position
   * @param position - goal position (4096 per rotation)
   */
  setGoalPosition(position: number, callback?: CompletionCallback): void {
    this.#sendCommand(
      INSTRUCTION.WRITE,
      ADDRESS.GOAL_POSITION,
      () => callback?.(),
      callback ?? (() => {}),
      ...int32ToDynamixelBytes(position),
    )
  }

  /**
   * sets goal angle
   * @param angle - angle in degree
   * @returns
   */
  setGoalAngle(angle: number, callback?: CompletionCallback): void {
    const position = angleToDynamixelPosition(angle)
    this.setGoalPosition(position, callback)
  }

  setLED(on: boolean, callback?: CompletionCallback): void {
    this.#sendCommand(INSTRUCTION.WRITE, ADDRESS.LED, () => callback?.(), callback ?? (() => {}), Number(on))
  }

  /**
   * sets offset angle
   * @param angle - offset angle
   */
  setOffsetAngle(angle: number, callback?: CompletionCallback): void {
    this.#sendCommand(
      INSTRUCTION.WRITE,
      ADDRESS.HOMING_OFFSET,
      () => callback?.(),
      callback ?? (() => {}),
      ...int32ToDynamixelBytes(angleToDynamixelPosition(angle)),
    )
  }

  /** Rebind the host endpoint to an already configured device, while idle. */
  setId(id: number): void {
    const change = this.#endpoint.beginIdChange(id)
    change.commit()
    change.close()
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
        INSTRUCTION.WRITE,
        ADDRESS.TORQUE_ENABLE,
        () => {
          change.send(
            this.#command(
              INSTRUCTION.WRITE,
              ADDRESS.ID,
              () => {
                change.commit()
                finish()
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
   * sets torque
   * @param enable - enable
   */
  setTorque(enable: boolean, callback?: CompletionCallback): void {
    this.#sendCommand(
      INSTRUCTION.WRITE,
      ADDRESS.TORQUE_ENABLE,
      () => callback?.(),
      callback ?? (() => {}),
      Number(enable),
    )
  }

  /**
   * reads model number
   * @returns Model number
   */
  readModelNumber(callback: ValueCallback<number>): void {
    this.#sendCommand(
      INSTRUCTION.READ,
      ADDRESS.MODEL_NUMBER,
      (values) => {
        if (values == null || values.length < 4) {
          callback(undefined, new Error('failed to read model number'))
          return
        }
        if (values[1] !== 0) {
          callback(undefined, new Error(`servo returned error code: ${values[1]} while reading model number`))
          return
        }
        // payload layout: [instruction/status, status_code, low, high]
        callback(el(values[3], values[2]))
      },
      (error) => callback(undefined, error),
      2,
    )
  }

  /**
   * reads firmware version
   * @returns Firmware version
   */
  readFirmwareVersion(callback: (result: Maybe<{ version: number }>) => void): void {
    this.#sendCommand(
      INSTRUCTION.READ,
      ADDRESS.VERSION_OF_FIRMWARE,
      (values) => {
        if (values != null && values.length >= 3 && values[1] === 0) {
          callback({
            success: true,
            value: {
              version: values[2],
            },
          })
          return
        }
        callback({
          success: false,
          reason: 'failed to read firmware version',
        })
      },
      (error) => callback(maybeFailure(error)),
      1,
    )
  }

  /**
   * reads offset angle
   * @returns offset angle
   */
  readOffsetAngle(callback: ValueCallback<number>): void {
    this.#sendCommand(
      INSTRUCTION.READ,
      ADDRESS.HOMING_OFFSET,
      (values) => {
        if (values == null || values.length < 2) {
          callback(undefined, new Error('failed to read offset angle'))
          return
        }
        if (values[1] !== 0) {
          callback(undefined, new Error(`servo returned error code: ${values[1]} while reading offset angle`))
          return
        }
        if (!dynamixelStatusPayloadHasData(values, 4)) {
          callback(undefined, new Error('failed to read offset angle'))
          return
        }
        callback(dynamixelPositionToAngle(int32FromDynamixelPayload(values)))
      },
      (error) => callback(undefined, error),
      4,
    )
  }

  /**
   * reads present current value (ma)
   * @returns current value
   */
  readPresentCurrent(callback: (result: Maybe<{ current: number }>) => void): void {
    this.#sendCommand(
      INSTRUCTION.READ,
      ADDRESS.PRESENT_CURRENT,
      (values) => {
        if (values != null && values.length >= 2 && values[1] !== 0) {
          callback({
            success: false,
            reason: `servo returned error code: ${values[1]}`,
          })
          return
        }
        if (dynamixelStatusPayloadHasData(values, 2)) {
          callback({
            success: true,
            value: {
              current: int16FromDynamixelPayload(values),
            },
          })
          return
        }
        callback({
          success: false,
        })
      },
      (error) => callback(maybeFailure(error)),
      2,
    )
  }

  /**
   * reads present velocity [rpm]
   * Velocity [rpm] = Value * 0.229 [rpm]
   * @returns velocity value
   */
  readPresentVelocity(callback: (result: Maybe<number>) => void): void {
    this.#sendCommand(
      INSTRUCTION.READ,
      ADDRESS.PRESENT_VELOCITY,
      (values) => {
        if (values != null && values.length >= 2 && values[1] !== 0) {
          callback({
            success: false,
            reason: `servo returned error code: ${values[1]}`,
          })
          return
        }
        if (dynamixelStatusPayloadHasData(values, 4)) {
          callback({
            success: true,
            value: int32FromDynamixelPayload(values),
          })
          return
        }
        callback({
          success: false,
        })
      },
      (error) => callback(maybeFailure(error)),
      4,
    )
  }

  /**
   * reads present position (4096 per rotation)
   * @returns position value
   */
  readPresentPosition(callback: (result: Maybe<number>) => void): void {
    this.#sendCommand(
      INSTRUCTION.READ,
      ADDRESS.PRESENT_POSITION,
      (values) => {
        if (values != null && values.length >= 2 && values[1] !== 0) {
          callback({
            success: false,
            reason: `servo returned error code: ${values[1]}`,
          })
          return
        }
        if (dynamixelStatusPayloadHasData(values, 4)) {
          callback({
            success: true,
            value: int32FromDynamixelPayload(values),
          })
          return
        }
        callback({
          success: false,
        })
      },
      (error) => callback(maybeFailure(error)),
      4,
    )
  }
}

export default Dynamixel
