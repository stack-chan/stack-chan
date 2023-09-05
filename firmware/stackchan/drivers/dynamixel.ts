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

function le(v: number): [number, number] {
  return [(v & 0xff00) >> 8, v & 0xff]
}
function el(h: number, l: number) {
  return ((h << 8) & 0xff00) + (l & 0xff)
}

let packetHandler: PacketHandler = null

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

export const BAUDRATE = {
  BAUD_9600: 0x00,
  BAUD_57600: 0x01,
  BAUD_115200: 0x02,
  BAUD_1000000: 0x03,
  BAUD_2000000: 0x04,
} as const
type Baudrate = typeof BAUDRATE[keyof typeof BAUDRATE]

export const OPERATING_MODE = {
  CURRENT: 0x00,
  VELOCITY: 0x01,
  POSITION: 0x03,
  EXTENDED_POSITION: 0x04,
  CURRENT_BASED_POSITION: 0x05,
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
  PROFILE_ACCELERATION: 108,
  PROFILE_VELOCITY: 112,
  PRESENT_CURRENT: 126,
  PRESENT_VELOCITY: 128,
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
            if (this.#idx === 1 && rxBuf[0] !== 0xff) {
              this.#idx = 0
            }
            if (this.#idx === 2 && rxBuf[1] !== 0xff) {
              this.#idx = 0
            }
            if (this.#idx >= 3) {
              if (rxBuf[2] === 0xfd) {
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
              if (command === INSTRUCTION.WRITE || command === INSTRUCTION.READ) {
                // trace(`got echo.  ... ${rxBuf.slice(0, this.#idx)} ignoring\n`)
              } else if (command === INSTRUCTION.STATUS) {
                // trace(`got response for ${id}. triggering callback ... ${rxBuf.slice(0, this.#idx)} \n`)
                this.#callbacks.get(id)?.(rxBuf.slice(7, this.#idx - 1))
              } else {
                // trace(`something wrong for ${id}. ${rxBuf.slice(0, this.#idx)} \n`)
                this.#callbacks.get(id)?.(rxBuf.slice(7, this.#idx - 1))
              }
              this.#idx = 0
              this.#state = RX_STATE.SEEK
            }
            break
          default:
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore 6113
            // eslint-disable-next-line no-case-declarations, @typescript-eslint/no-unused-vars
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
 * @param arr - packet array except checksum
 * @returns checksum number
 */
function checksum(arr: number[] | Uint8Array, start = 0, end): number {
  end = end ?? arr.length
  let crc16 = 0
  for (let i = start; i < end; i++) {
    const n = arr[i]
    crc16 ^= n << 8
    for (let i = 0; i < 8; i++) {
      if (crc16 & 0x8000) {
        crc16 = (crc16 << 1) ^ 0x8005
      } else {
        crc16 = crc16 << 1
      }
    }
  }
  return crc16
}

type DynamixelConstructorParam = {
  id: number
  baudrate?: number
}

class Dynamixel {
  static packetHandler: PacketHandler
  static setBaud(baud: number): void {
    // Dynamixel.packetHandler?.close()
    // Dynamixel.packetHandler = new PacketHandler({
    packetHandler?.close()
    packetHandler = new PacketHandler({
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
  constructor({ id, baudrate = 1_000_000 }: DynamixelConstructorParam) {
    this.#id = id
    this.#promises = []
    this.#onCommandRead = (values) => {
      if (this.#promises.length > 0) {
        const [resolver, timeoutId] = this.#promises.shift()
        Timer.clear(timeoutId)
        resolver(values)
      }
    }
    this.#txBuf = new Uint8Array(64)
    if (packetHandler == null) {
      packetHandler = new PacketHandler({
        receive: config.serial?.receive ?? 16,
        transmit: config.serial?.transmit ?? 17,
        baud: baudrate,
        port: 2,
      })
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

  async #sendCommand(instruction: Instruction, address?: Address, ...parameters: number[]): Promise<Uint8Array> {
    this.#txBuf[0] = 0xff
    this.#txBuf[1] = 0xff
    this.#txBuf[2] = 0xfd
    this.#txBuf[3] = 0x00
    this.#txBuf[4] = this.#id

    this.#txBuf[7] = instruction // write or read
    let idx = 8
    if (address) {
      this.#txBuf[idx++] = address & 0xff
      this.#txBuf[idx++] = (address >> 8) & 0xff
    }

    if (instruction === INSTRUCTION.READ) {
      const numRead = parameters[0] ?? 1
      this.#txBuf[idx++] = numRead & 0xff
      this.#txBuf[idx++] = (numRead >> 8) & 0xff
    } else {
      for (const v of parameters) {
        this.#txBuf[idx++] = v
      }
    }

    const len = idx - 5 // instruction(1) + params(0~) + crc(2)
    this.#txBuf[5] = len & 0xff
    this.#txBuf[6] = (len >> 8) & 0xff

    const crc = checksum(this.#txBuf, 0, idx)
    this.#txBuf[idx++] = crc & 0xff
    this.#txBuf[idx++] = (crc >> 8) & 0xff
    /*
    trace('writing: ')
    for (const n of this.#txBuf.slice(0, idx)) {
      trace(Number(n).toString(16).padStart(2, '0'))
      trace(' ')
    }
    trace('\n')
    */
    for (let i = 0; i < idx; i++) {
      packetHandler.write(this.#txBuf[i])
    }
    return new Promise((resolve) => {
      const id = Timer.set(() => {
        this.#promises.shift()
        trace(`timeout. ${this.#promises.length}\n`)
        resolve(undefined)
      }, 200)
      this.#promises.push([resolve, id])
    })
  }

  /**
   * resets values to factory default
   */
  async factoryReset(): Promise<unknown> {
    return this.#sendCommand(INSTRUCTION.FACTORY_RESET, null, 0x01 /* reset values except id and baudrate*/)
  }

  /**
   * reboots servo
   */
  async reboot(): Promise<unknown> {
    return this.#sendCommand(INSTRUCTION.REBOOT)
  }

  /**
   * sets operating mode
   * @param mode - operating mode
   * @see https://emanual.robotis.com/docs/en/dxl/x/xl330-m288/#operating-mode
   */
  async setOperatingMode(mode: OperatingMode): Promise<unknown> {
    await this.setTorque(false)
    return this.#sendCommand(INSTRUCTION.WRITE, ADDRESS.OPERATING_MODE, mode)
  }

  /**
   * sets baudrate
   * @param baudrate - baudrate(bps)
   */
  async setBaudrate(baudrate: Baudrate): Promise<unknown> {
    await this.setTorque(false)
    return this.#sendCommand(INSTRUCTION.WRITE, ADDRESS.BAUDRATE, baudrate)
  }

  /**
   * sets profile acceleration
   * @param accel - profile acceleration
   */
  async setProfileAcceleration(accel: number): Promise<unknown> {
    const a = accel & 0xff
    const b = (accel >> 8) & 0xff
    const c = (accel >> 16) & 0xff
    const d = (accel >> 24) & 0xff
    return this.#sendCommand(INSTRUCTION.WRITE, ADDRESS.PROFILE_ACCELERATION, a, b, c, d)
  }

  /**
   * sets profile velocity
   * Velocity [rpm] = Value * 0.229 [rpm]
   * @param velocity - goal velocity (ma)
   */
  async setProfileVelocity(velocity: number): Promise<unknown> {
    const a = velocity & 0xff
    const b = (velocity >> 8) & 0xff
    const c = (velocity >> 16) & 0xff
    const d = (velocity >> 24) & 0xff
    return this.#sendCommand(INSTRUCTION.WRITE, ADDRESS.PROFILE_VELOCITY, a, b, c, d)
  }

  /**
   * sets goal current
   * @param position - goal current (ma)
   */
  async setGoalCurrent(current: number): Promise<unknown> {
    const a = current & 0xff
    const b = (current >> 8) & 0xff
    return this.#sendCommand(INSTRUCTION.WRITE, ADDRESS.GOAL_CURRENT, a, b)
  }

  /**
   * sets goal position
   * @param position - goal position (4096 per rotation)
   */
  async setGoalPosition(position: number): Promise<unknown> {
    const a = position & 0xff
    const b = (position >> 8) & 0xff
    const c = (position >> 16) & 0xff
    const d = (position >> 24) & 0xff
    // trace(`${a}, ${b}, ${c}, ${d}\n`)
    return this.#sendCommand(INSTRUCTION.WRITE, ADDRESS.GOAL_POSITION, a, b, c, d)
  }

  /**
   * sets goal angle
   * @param angle - angle in degree
   * @returns
   */
  async setGoalAngle(angle: number): Promise<unknown> {
    const position = (angle * 4096) / 360
    return this.setGoalPosition(position)
  }

  async setLED(on: boolean): Promise<unknown> {
    return this.#sendCommand(INSTRUCTION.WRITE, ADDRESS.LED, Number(on))
  }

  /**
   * sets offset angle
   * @param angle - offset angle
   */
  async setOffsetAngle(angle: number): Promise<unknown> {
    if (angle < 0) {
      angle *= -1
    }
    const value = (angle * 360) / 4096
    return this.#sendCommand(INSTRUCTION.WRITE, ADDRESS.HOMING_OFFSET, ...le(value))
  }

  setId(id: number): void {
    this.#id = id
  }

  /**
   * changes id
   * @param enable - enable
   */
  async flashId(id: number): Promise<unknown> {
    if (packetHandler.hasCallbackOf(id)) {
      throw new Error(`id(${id}) is already used\n`)
    }
    await this.setTorque(false)
    const promise = this.#sendCommand(INSTRUCTION.WRITE, ADDRESS.ID, id)
    const oldId = this.#id
    this.#id = id
    packetHandler.registerCallback(this.#id, this.#onCommandRead)
    await promise
    packetHandler.removeCallback(oldId)
    return
  }

  /**
   * sets torque
   * @param enable - enable
   */
  async setTorque(enable: boolean): Promise<unknown> {
    return this.#sendCommand(INSTRUCTION.WRITE, ADDRESS.TORQUE_ENABLE, Number(enable))
  }

  /**
   * reads model number
   * @returns Model number
   */
  async readModelNumber(): Promise<number> {
    const values = await this.#sendCommand(INSTRUCTION.READ, ADDRESS.MODEL_NUMBER, 2)
    return el(values[0], values[1])
  }

  /**
   * reads firmware version
   * @returns Firmware version
   */
  async readFirmwareVersion(): Promise<Maybe<{ version: number }>> {
    const values = await this.#sendCommand(INSTRUCTION.READ, ADDRESS.VERSION_OF_FIRMWARE, 1)
    if (values != null && values[1] == 0) {
      return {
        success: true,
        value: {
          version: values[2],
        },
      }
    } else {
      return {
        success: false,
        reason: 'failed to read firmware version',
      }
    }
  }

  /**
   * reads offset angle
   * @returns offset angle
   */
  async readOffsetAngle(): Promise<number> {
    const values = await this.#sendCommand(INSTRUCTION.READ, ADDRESS.HOMING_OFFSET, 2)
    const isCcw = Boolean(values[0] & 0x8000)
    let offset = ((values[1] & 0x7fff) << 8) | values[0]
    if (isCcw) {
      offset *= -1
    }
    return offset
  }

  /**
   * reads present current value (ma)
   * @returns current value
   */
  async readPresentCurrent(): Promise<Maybe<{ current: number }>> {
    const values = await this.#sendCommand(INSTRUCTION.READ, ADDRESS.PRESENT_CURRENT, 2)
    if (values != null) {
      if (values[1] != 0) {
        return {
          success: false,
          reason: `servo returned error code: ${values[1]}`,
        }
      }
      const current = values[2] | (values[3] << 8)
      return {
        success: true,
        value: {
          current: current >= 0x8000 ? current - 0x10000 : current,
        },
      }
    } else {
      return {
        success: false,
      }
    }
  }

  /**
   * reads present velocity [rpm]
   * Velocity [rpm] = Value * 0.229 [rpm]
   * @returns velocity value
   */
  async readPresentVelocity(): Promise<Maybe<number>> {
    const values = await this.#sendCommand(INSTRUCTION.READ, ADDRESS.PRESENT_VELOCITY, 4)
    if (values != null) {
      if (values[1] != 0) {
        return {
          success: false,
          reason: `servo returned error code: ${values[1]}`,
        }
      }
      const velocity = values[2] | (values[3] << 8)
      return {
        success: true,
        value: velocity >= 0x8000 ? velocity - 0x10000 : velocity,
      }
    } else {
      return {
        success: false,
      }
    }
  }

  /**
   * reads present position (4096 per rotation)
   * @returns position value
   */
  async readPresentPosition(): Promise<Maybe<number>> {
    const values = await this.#sendCommand(INSTRUCTION.READ, ADDRESS.PRESENT_POSITION, 4)
    if (values != null) {
      if (values[1] != 0) {
        return {
          success: false,
          reason: `servo returned error code: ${values[1]}`,
        }
      }
      const position = values[2] | (values[3] << 8)
      return {
        success: true,
        value: position >= 0x8000 ? position - 0x10000 : position,
      }
    } else {
      return {
        success: false,
      }
    }
  }
}

export default Dynamixel
