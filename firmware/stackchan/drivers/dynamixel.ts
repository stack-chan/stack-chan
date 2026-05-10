import Serial from 'embedded:io/serial'
import config from 'mc/config'
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
  STATUS_RETURN_LEVEL: 68,
  GOAL_CURRENT: 102,
  PROFILE_ACCELERATION: 108,
  PROFILE_VELOCITY: 112,
  GOAL_POSITION: 116,
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

const RESPONSE_TIMEOUT_MS = 60

class PacketHandler extends Serial {
  #callbacks: Map<number, (buffer: Uint8Array, offset: number, length: number) => void>
  #rxBuffer: Uint8Array
  #chunkBuffer: Uint8Array
  #idx: number
  #state: RxState
  #count: number

  constructor(option) {
    const onReadable = function (this: PacketHandler, bytesReadable: number) {
      let remaining = bytesReadable
      while (remaining > 0) {
        const requestLength = remaining > this.#chunkBuffer.length ? this.#chunkBuffer.length : remaining
        const readLength = this.read(this.#chunkBuffer.subarray(0, requestLength)) as number
        if (readLength == null || readLength <= 0) {
          return
        }
        this.#consumeChunk(this.#chunkBuffer, readLength)
        remaining -= readLength
      }
    }
    super({
      ...option,
      format: 'buffer',
      onReadable,
    })
    this.#callbacks = new Map<number, (buffer: Uint8Array, offset: number, length: number) => void>()
    this.#rxBuffer = new Uint8Array(96)
    this.#chunkBuffer = new Uint8Array(32)
    this.#idx = 0
    this.#state = RX_STATE.SEEK
    this.#count = 0
  }

  #resetSeek() {
    this.#idx = 0
    this.#state = RX_STATE.SEEK
    this.#count = 0
  }

  #consumeChunk(source: Uint8Array, length: number): void {
    const rxBuf = this.#rxBuffer
    for (let i = 0; i < length; i++) {
      if (this.#idx >= rxBuf.length) {
        this.#resetSeek()
      }
      rxBuf[this.#idx++] = source[i]
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
              this.#idx = 0
            }
          }
          break
        case RX_STATE.HEAD:
          if (this.#idx >= 7) {
            this.#count = (rxBuf[6] << 8) | rxBuf[5]
            this.#state = RX_STATE.BODY
          }
          break
        case RX_STATE.BODY:
          this.#count -= 1
          if (this.#count <= 0) {
            const command = rxBuf[7] as Instruction
            if (command === INSTRUCTION.STATUS) {
              const callback = this.#callbacks.get(rxBuf[4])
              if (callback != null) {
                const payloadLength = this.#idx - 9
                if (payloadLength > 0) {
                  callback(rxBuf, 7, payloadLength)
                }
              }
            }
            this.#resetSeek()
          }
          break
      }
    }
  }

  hasCallbackOf(id: number): boolean {
    return this.#callbacks.has(id)
  }
  registerCallback(id: number, callback: (buffer: Uint8Array, offset: number, length: number) => void) {
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
function checksum(arr: number[] | Uint8Array, start = 0, end = arr.length): number {
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

type PendingCommand = {
  instruction: Instruction
  address: Address | null
  parameters: number[]
  waitForResponse: boolean
  expectedResponseMinLength: number
  resolve: (value: number | undefined) => void
  reject: (reason: unknown) => void
}

class Dynamixel {
  static packetHandler: PacketHandler
  static setBaud(baud: number): void {
    packetHandler?.close()
    packetHandler = new PacketHandler({
      receive: config.serial?.receive ?? 6,
      transmit: config.serial?.transmit ?? 7,
      baud,
      port: 1,
    })
  }

  #id: number
  #onCommandRead: (buffer: Uint8Array, offset: number, length: number) => void
  #txBuf: Uint8Array
  #responseBuffer: Uint8Array
  #responseLength: number
  #expectedResponseMinLength: number
  #waitSlot: SingleWaitSlot<number>
  #queue: PendingCommand[]
  #queueRunning: boolean

  constructor({ id, baudrate = 1_000_000 }: DynamixelConstructorParam) {
    this.#id = id
    this.#txBuf = new Uint8Array(64)
    this.#responseBuffer = new Uint8Array(16)
    this.#responseLength = 0
    this.#expectedResponseMinLength = 0
    this.#waitSlot = new SingleWaitSlot<number>(Timer.set, Timer.clear)
    this.#queue = []
    this.#queueRunning = false
    this.#onCommandRead = (buffer, offset, length) => {
      if (!this.#waitSlot.isWaiting) {
        return
      }
      if (length < this.#expectedResponseMinLength) {
        return
      }
      if (buffer[offset] !== INSTRUCTION.STATUS) {
        return
      }
      if (this.#responseBuffer.length < length) {
        this.#responseBuffer = new Uint8Array(length)
      }
      this.#responseBuffer.set(buffer.subarray(offset, offset + length))
      this.#responseLength = length
      this.#waitSlot.resolve(length)
    }
    if (packetHandler == null) {
      packetHandler = new PacketHandler({
        receive: config.serial?.receive ?? 6,
        transmit: config.serial?.transmit ?? 7,
        baud: baudrate,
        port: 1,
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

  #writeCommandPacket(command: PendingCommand): void {
    this.#txBuf[0] = 0xff
    this.#txBuf[1] = 0xff
    this.#txBuf[2] = 0xfd
    this.#txBuf[3] = 0x00
    this.#txBuf[4] = this.#id
    this.#txBuf[7] = command.instruction
    let idx = 8

    if (command.address != null) {
      this.#txBuf[idx++] = command.address & 0xff
      this.#txBuf[idx++] = (command.address >> 8) & 0xff
    }

    if (command.instruction === INSTRUCTION.READ) {
      const numRead = command.parameters[0] ?? 1
      this.#txBuf[idx++] = numRead & 0xff
      this.#txBuf[idx++] = (numRead >> 8) & 0xff
    } else {
      for (let i = 0; i < command.parameters.length; i++) {
        this.#txBuf[idx++] = command.parameters[i]
      }
    }

    const len = idx - 5
    this.#txBuf[5] = len & 0xff
    this.#txBuf[6] = (len >> 8) & 0xff
    const crc = checksum(this.#txBuf, 0, idx)
    this.#txBuf[idx++] = crc & 0xff
    this.#txBuf[idx++] = (crc >> 8) & 0xff
    packetHandler.write(this.#txBuf.subarray(0, idx))
  }

  #dispatchCommandWithWait(command: PendingCommand): Promise<number | undefined> {
    this.#responseLength = 0
    this.#expectedResponseMinLength = command.expectedResponseMinLength
    const response = this.#waitSlot.wait(RESPONSE_TIMEOUT_MS)
    this.#writeCommandPacket(command)
    return response
  }

  async #processQueue(): Promise<void> {
    while (this.#queue.length > 0) {
      const command = this.#queue.shift()
      if (command == null) {
        continue
      }
      try {
        if (!command.waitForResponse) {
          this.#writeCommandPacket(command)
          command.resolve(undefined)
          continue
        }
        const result = await this.#dispatchCommandWithWait(command)
        command.resolve(result)
      } catch (error) {
        command.reject(error)
      }
    }
    this.#queueRunning = false
  }

  #sendCommand(
    instruction: Instruction,
    address: Address | null,
    waitForResponse: boolean,
    expectedResponseMinLength: number,
    ...parameters: number[]
  ): Promise<number | undefined> {
    return new Promise((resolve, reject) => {
      this.#queue.push({
        instruction,
        address,
        parameters,
        waitForResponse,
        expectedResponseMinLength,
        resolve,
        reject,
      })
      if (!this.#queueRunning) {
        this.#queueRunning = true
        void this.#processQueue()
      }
    })
  }

  #sendReadCommand(address: Address, readLength: number): Promise<number | undefined> {
    return this.#sendCommand(INSTRUCTION.READ, address, true, 2 + readLength, readLength)
  }

  #sendWriteCommand(address: Address, ...parameters: number[]): Promise<number | undefined> {
    return this.#sendCommand(INSTRUCTION.WRITE, address, false, 0, ...parameters)
  }

  #sendInstructionCommand(
    instruction: Instruction,
    waitForResponse = true,
    expectedResponseMinLength = 2,
    ...parameters: number[]
  ): Promise<number | undefined> {
    return this.#sendCommand(instruction, null, waitForResponse, expectedResponseMinLength, ...parameters)
  }

  #hasValidResponse(minLength: number): boolean {
    return this.#responseLength >= minLength && this.#responseBuffer[0] === INSTRUCTION.STATUS
  }

  #readSignedWord(offset: number): number {
    const value = this.#responseBuffer[offset] | (this.#responseBuffer[offset + 1] << 8)
    return value >= 0x8000 ? value - 0x10000 : value
  }

  #readSignedDword(offset: number): number {
    return (
      this.#responseBuffer[offset] |
      (this.#responseBuffer[offset + 1] << 8) |
      (this.#responseBuffer[offset + 2] << 16) |
      (this.#responseBuffer[offset + 3] << 24)
    )
  }

  /**
   * resets values to factory default
   */
  async factoryReset(): Promise<unknown> {
    return this.#sendInstructionCommand(INSTRUCTION.FACTORY_RESET, true, 2, 0x01)
  }

  /**
   * reboots servo
   */
  async reboot(): Promise<unknown> {
    return this.#sendInstructionCommand(INSTRUCTION.REBOOT, true, 2)
  }

  /**
   * sets operating mode
   * @param mode - operating mode
   * @see https://emanual.robotis.com/docs/en/dxl/x/xl330-m288/#operating-mode
   */
  async setOperatingMode(mode: OperatingMode): Promise<unknown> {
    await this.setTorque(false)
    return this.#sendWriteCommand(ADDRESS.OPERATING_MODE, mode)
  }

  /**
   * sets baudrate
   * @param baudrate - baudrate(bps)
   */
  async setBaudrate(baudrate: Baudrate): Promise<unknown> {
    await this.setTorque(false)
    return this.#sendWriteCommand(ADDRESS.BAUDRATE, baudrate)
  }

  async setStatusReturnLevel(level: 0 | 1 | 2): Promise<unknown> {
    return this.#sendWriteCommand(ADDRESS.STATUS_RETURN_LEVEL, level)
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
    return this.#sendWriteCommand(ADDRESS.PROFILE_ACCELERATION, a, b, c, d)
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
    return this.#sendWriteCommand(ADDRESS.PROFILE_VELOCITY, a, b, c, d)
  }

  /**
   * sets goal current
   * @param position - goal current (ma)
   */
  async setGoalCurrent(current: number): Promise<unknown> {
    const a = current & 0xff
    const b = (current >> 8) & 0xff
    return this.#sendWriteCommand(ADDRESS.GOAL_CURRENT, a, b)
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
    return this.#sendWriteCommand(ADDRESS.GOAL_POSITION, a, b, c, d)
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
    return this.#sendWriteCommand(ADDRESS.LED, Number(on))
  }

  /**
   * sets offset angle
   * @param angle - offset angle
   */
  async setOffsetAngle(angle: number): Promise<unknown> {
    const value = (Math.abs(angle) * 360) / 4096
    return this.#sendWriteCommand(ADDRESS.HOMING_OFFSET, ...le(value))
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
    const oldId = this.#id
    await this.#sendWriteCommand(ADDRESS.ID, id)
    packetHandler.removeCallback(oldId)
    this.#id = id
    packetHandler.registerCallback(this.#id, this.#onCommandRead)
    return
  }

  /**
   * sets torque
   * @param enable - enable
   */
  async setTorque(enable: boolean): Promise<unknown> {
    return this.#sendWriteCommand(ADDRESS.TORQUE_ENABLE, Number(enable))
  }

  /**
   * reads model number
   * @returns Model number
   */
  async readModelNumber(): Promise<number> {
    const length = await this.#sendReadCommand(ADDRESS.MODEL_NUMBER, 2)
    if (length == null || !this.#hasValidResponse(4)) {
      throw new Error('failed to read model number')
    }
    if (this.#responseBuffer[1] !== 0) {
      throw new Error(`servo returned error code: ${this.#responseBuffer[1]} while reading model number`)
    }
    return el(this.#responseBuffer[3], this.#responseBuffer[2])
  }

  /**
   * reads firmware version
   * @returns Firmware version
   */
  async readFirmwareVersion(): Promise<Maybe<{ version: number }>> {
    const length = await this.#sendReadCommand(ADDRESS.VERSION_OF_FIRMWARE, 1)
    if (length != null && this.#hasValidResponse(3) && this.#responseBuffer[1] === 0) {
      return {
        success: true,
        value: {
          version: this.#responseBuffer[2],
        },
      }
    }
    return {
      success: false,
      reason: 'failed to read firmware version',
    }
  }

  /**
   * reads offset angle
   * @returns offset angle
   */
  async readOffsetAngle(): Promise<number> {
    const length = await this.#sendReadCommand(ADDRESS.HOMING_OFFSET, 2)
    if (length == null || !this.#hasValidResponse(4)) {
      throw new Error('failed to read offset angle')
    }
    const offset = this.#readSignedWord(2)
    return offset
  }

  /**
   * reads present current value (ma)
   * @returns current value
   */
  async readPresentCurrent(): Promise<Maybe<{ current: number }>> {
    const length = await this.#sendReadCommand(ADDRESS.PRESENT_CURRENT, 2)
    if (length != null && this.#hasValidResponse(4)) {
      if (this.#responseBuffer[1] !== 0) {
        return {
          success: false,
          reason: `servo returned error code: ${this.#responseBuffer[1]}`,
        }
      }
      return {
        success: true,
        value: {
          current: this.#readSignedWord(2),
        },
      }
    }
    return {
      success: false,
    }
  }

  /**
   * reads present velocity [rpm]
   * Velocity [rpm] = Value * 0.229 [rpm]
   * @returns velocity value
   */
  async readPresentVelocity(): Promise<Maybe<number>> {
    const length = await this.#sendReadCommand(ADDRESS.PRESENT_VELOCITY, 4)
    if (length != null && this.#hasValidResponse(6)) {
      if (this.#responseBuffer[1] !== 0) {
        return {
          success: false,
          reason: `servo returned error code: ${this.#responseBuffer[1]}`,
        }
      }
      return {
        success: true,
        value: this.#readSignedDword(2),
      }
    }
    return {
      success: false,
    }
  }

  async readPresentPositionValue(): Promise<number | undefined> {
    const length = await this.#sendReadCommand(ADDRESS.PRESENT_POSITION, 4)
    if (length == null || !this.#hasValidResponse(6)) {
      return undefined
    }
    if (this.#responseBuffer[1] !== 0) {
      return undefined
    }
    return this.#readSignedDword(2)
  }

  /**
   * reads present position (4096 per rotation)
   * @returns position value
   */
  async readPresentPosition(): Promise<Maybe<number>> {
    const position = await this.readPresentPositionValue()
    if (position == null) {
      return {
        success: false,
      }
    }
    return {
      success: true,
      value: position,
    }
  }
}

export default Dynamixel
