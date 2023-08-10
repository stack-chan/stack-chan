import Serial from 'embedded:io/serial'
import Timer from 'timer'
import config from 'mc/config'

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
function lle(a, b, c, _d): number {
  return ((c & 0xff) << 16) | ((b & 0xff) << 8) | (a & 0xff)
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
type Instruction = typeof INSTRUCTION[keyof typeof INSTRUCTION]

export const OPERATING_MODE = {
  CURRENT: 0x00,
  VELOCITY: 0x01,
  POSITION: 0x03,
  EXTENDED_POSITION: 0x04,
  CURRENT_BASE_POSITION: 0x05,
  PWM: 0x10,
} as const
type OperatingMode = typeof OPERATING_MODE[keyof typeof OPERATING_MODE]

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
  PRESENT_CURRENT: 126,
  PRESENT_POSITION: 132,
} as const

type Address = typeof ADDRESS[keyof typeof ADDRESS]

const RX_STATE = {
  SEEK: 0,
  HEAD: 1,
  BODY: 2,
} as const
type RxState = typeof RX_STATE[keyof typeof RX_STATE]

class PacketHandler extends Serial {
  #callbacks: Map<number, (bytes: Uint8Array) => void>
  #rxBuffer: Uint8Array
  #idx: number
  #state: RxState
  #id: number
  #count: number
  constructor(option) {
    const onReadable = function (this: PacketHandler, bytes: number) {
      const rxBuf = this.#rxBuffer
      while (bytes > 0) {
        // NOTE: We can safely read a number
        rxBuf[this.#idx++] = this.read() as number
        bytes -= 1
        switch (this.#state) {
          case RX_STATE.SEEK:
            if (this.#idx >= 3) {
              // see header
              if (rxBuf[0] === 0xff && rxBuf[1] === 0xff && rxBuf[2] === 0xfd) {
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
            if (this.#idx >= 7) {
              this.#count = (rxBuf[6] << 8) | rxBuf[5]
              this.#state = RX_STATE.BODY
              // trace(`length: ${this.#count}\n`)
            }
            break
          case RX_STATE.BODY:
            this.#count -= 1
            if (this.#count === 0) {
              const id = rxBuf[4]
              const command = rxBuf[7] as Instruction
              if (command !== INSTRUCTION.STATUS) {
                // trace(`got echo.  ... ${rxBuf.slice(0, this.#idx)} ignoring\n`)
              } else {
                trace(`got response for ${id}. triggering callback ... ${rxBuf.slice(0, this.#idx)} \n`)
                this.#callbacks.get(id)?.(rxBuf.slice(7, this.#idx - 1))
              }
              this.#idx = 0
              this.#state = RX_STATE.SEEK
            }
            break
          default:
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore 6113
            let _state: never
        }
        // noop
      }
    }
    super({
      ...option,
      format: 'number',
      onReadable,
    })
    this.#callbacks = new Map<number, () => void>()
    this.#rxBuffer = new Uint8Array(64)
    this.#idx = 0
    this.#state = RX_STATE.SEEK
  }
  hasCallbackOf(id: number): boolean {
    return this.#callbacks.has(id)
  }
  registerCallback(id: number, callback: (bytes: Uint8Array) => void) {
    this.#callbacks.set(id, callback)
  }
  removeCallback(id: number) {
    this.#callbacks.delete(id)
  }
}

/**
 * calculates checksum
 * @param arr packet array except checksum
 * @returns checksum number
 */
function checksum(arr: number[] | Uint8Array): number {
  let crc16 = 0
  for (const n of arr) {
    crc16 ^= (n << 8)
    for (let i = 0; i < 8; i++) {
      if (crc16 & 0x8000) {
        crc16 = (crc16 << 1) ^ 0x8005
      } else {
        crc16 = crc16 << 1;
      }
    }
  }
  return crc16
}

type DynamixelConstructorParam = {
  id: number
}

class Dynamixel {
  static packetHandler: PacketHandler
  static setBaud(baud: number): void {
    Dynamixel.packetHandler?.close()
    Dynamixel.packetHandler = new PacketHandler({
      receive: config.serial?.receive ?? 16,
      transmit: config.serial?.transmit ?? 17,
      baud,
      port: 2,
    })
  }
  #id: number
  #onCommandRead: (values: Uint8Array) => void
  #txBuf: Uint8Array
  #promises: Array<[(values: Uint8Array) => void, Timer]>
  #offset: number
  constructor({ id }: DynamixelConstructorParam) {
    this.#id = id
    this.#promises = []
    this.#offset = 0
    this.#onCommandRead = (values) => {
      if (this.#promises.length > 0) {
        const [resolver, timeoutId] = this.#promises.shift()
        Timer.clear(timeoutId)
        resolver(values)
      }
    }
    this.#txBuf = new Uint8Array(64)
    if (Dynamixel.packetHandler == null) {
      Dynamixel.packetHandler = new PacketHandler({
        receive: config.serial?.receive ?? 16,
        transmit: config.serial?.transmit ?? 17,
        baud: 57_600,
        port: 2,
      })
    }
    if (Dynamixel.packetHandler.hasCallbackOf(id)) {
      throw new Error('This id is already instantiated')
    }
    Dynamixel.packetHandler.registerCallback(this.#id, this.#onCommandRead)
  }
  teardown(): void {
    Dynamixel.packetHandler.removeCallback(this.#id)
  }
  get id(): number {
    return this.#id
  }

  async #sendCommand(instruction: Instruction, address: number, ...parameters: number[]): Promise<Uint8Array> {
    this.#txBuf[0] = 0xff
    this.#txBuf[1] = 0xff
    this.#txBuf[2] = 0xfd
    this.#txBuf[3] = 0x00
    this.#txBuf[4] = this.#id

    const len = parameters.length + 5 // params + instruction(1) + address(2) + crc(2)
    this.#txBuf[5] = len & 0xff
    this.#txBuf[6] = (len >> 8) & 0xff
    this.#txBuf[7] = instruction // write or read
    this.#txBuf[8] = address & 0xff
    this.#txBuf[9] = (address >> 8) & 0xff

    let idx = 10
    for (const v of parameters) {
      this.#txBuf[idx] = v
      idx++
    }

    const crc = checksum(this.#txBuf.slice(0, idx))
    this.#txBuf[idx] = crc & 0xff
    idx++
    this.#txBuf[idx] = (crc >> 8) & 0xff
    idx++
    trace('writing: ')
    for (let n of this.#txBuf.slice(0, idx)) {
      trace(Number(n).toString(16).padStart(2, '0'))
      trace(' ')
    }
    trace('\n')
    for (let i = 0; i < idx; i++) {
      Dynamixel.packetHandler.write(this.#txBuf[i])
    }
    return new Promise((resolve, _reject) => {
      const id = Timer.set(() => {
        this.#promises.shift()
        // trace(`timeout. ${this.#promises.length}\n`)
        resolve(undefined)
      }, 40)
      this.#promises.push([resolve, id])
    })
  }

  async readModelNumber(): Promise<number> {
    const values = await this.#sendCommand(INSTRUCTION.READ, ADDRESS.MODEL_NUMBER, 2)
    return el(values[0], values[1])
  }

  /**
   * reads offset angle
   * @note SCS series does not have zero position calibration function.
   *  The offset value should be handled by the application.
   */
  async readOffsetAngle(): Promise<number> {
    const values = await this.#sendCommand(INSTRUCTION.READ, ADDRESS.HOMING_OFFSET, 2)
    const isCcw = Boolean(values[0] & 0x8000)
    let offset = ((values[0] & 0x7fff) << 8) | values[1]
    if (isCcw) {
      offset *= -1
    }
    return offset
  }

  async setOperatingMode(mode: OperatingMode): Promise<unknown> {
    await this.setTorque(false)
    return this.#sendCommand(INSTRUCTION.WRITE, ADDRESS.OPERATING_MODE, mode)
  }

  async setGoalCurrent(current: number): Promise<unknown> {
    const a = current & 0xff
    const b = (current >> 8) & 0xff
    return this.#sendCommand(INSTRUCTION.WRITE, ADDRESS.GOAL_CURRENT, a, b)
  }

  async setGoalPosition(position: number): Promise<unknown> {
    const a = position & 0xff
    const b = (position >> 8) & 0xff
    return this.#sendCommand(INSTRUCTION.WRITE, ADDRESS.GOAL_POSITION, a, b, 0x00, 0x00)
  }

  async setLED(on: boolean): Promise<unknown> {
    return this.#sendCommand(INSTRUCTION.WRITE, ADDRESS.LED, Number(on))
  }

  /**
   * sets offset angle
   * @param angle offset angle (-2000 to 2000)
   */
  async setOffsetAngle(angle: number): Promise<unknown> {
    this.#offset = angle
    const isCcw = angle < 0
    if (isCcw) {
      angle *= -1
    }
    const value = (Number(isCcw) << 15) | (angle & 0x7fff)
    return this.#sendCommand(INSTRUCTION.WRITE, ADDRESS.HOMING_OFFSET, ...le(value))
  }

  setId(id: number): void {
    this.#id = id
  }

  async flashId(id: number): Promise<unknown> {
    if (Dynamixel.packetHandler.hasCallbackOf(id)) {
      throw new Error(`id(${id}) is already used\n`)
    }
    const promise = this.#sendCommand(INSTRUCTION.WRITE, ADDRESS.ID, id)
    const oldId = this.#id
    this.#id = id
    Dynamixel.packetHandler.registerCallback(this.#id, this.#onCommandRead)
    await promise
    Dynamixel.packetHandler.removeCallback(oldId)
    return
  }

  /**
   * sets angle immediately
   * @param angle angle(degree)
   * @returns TBD
   */
  async setAngle(angle: number): Promise<unknown> {
    const a = Math.floor(clamp(((angle + this.#offset) * 1024) / 200, 0, 0x03ff))
    return this.#sendCommand(INSTRUCTION.WRITE, ADDRESS.GOAL_POSITION, ...le(a))
  }

  /**
   * sets angle within goal time
   * @param angle angle(degree)
   * @param goalTime time(millisecond)
   * @returns TBD
   */
  async setAngleInTime(angle: number, goalTime: number): Promise<unknown> {
    // 0 <= a <= 1023
    const a = Math.floor(clamp(((angle + this.#offset) * 1024) / 200, 0, 0x03ff))
    const res = await this.#sendCommand(INSTRUCTION.WRITE, ADDRESS.GOAL_POSITION, ...le(a), ...le(goalTime))
    return res
  }

  /**
   * sets torque
   * @param enable enable
   * @returns TBD
   */
  async setTorque(enable: boolean): Promise<unknown> {
    return this.#sendCommand(INSTRUCTION.WRITE, ADDRESS.TORQUE_ENABLE, Number(enable))
  }

  async readPresentCurrent(): Promise<Maybe<{ current: number }>> {
    const values = await this.#sendCommand(INSTRUCTION.READ, ADDRESS.PRESENT_CURRENT, 2)
    if (values != null) {
      trace(`values: ${values}\n`)
      return {
        success: true,
        value: {
          current: values[0]
        }
      }
    }
    else {
      return {
        success: false
      }
    }
  }

  /**
   * reads servo's present status
   * @returns angle(degree)
   */
  async readStatus(): Promise<Maybe<{ angle: number }>> {
    const values = await this.#sendCommand(INSTRUCTION.READ, ADDRESS.PRESENT_POSITION, 15)
    if (values == null || values.length < 15) {
      return {
        success: false,
        reason: 'response corrupted.',
      }
    }
    const angle = (el(values[0], values[1]) * 200) / 1024
    return {
      success: true,
      value: { angle },
    }
  }
}

export default Dynamixel
