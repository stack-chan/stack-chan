const DEFAULT_ADDRESS = 0x6f

declare const trace: (message: string) => void

const REG_VERSION = 0x02
const REG_GPIO_M_L = 0x03
const REG_GPIO_M_H = 0x04
const REG_GPIO_O_L = 0x05
const REG_GPIO_O_H = 0x06
const REG_GPIO_PU_L = 0x09
const REG_GPIO_PU_H = 0x0a
const REG_GPIO_PD_L = 0x0b
const REG_GPIO_PD_H = 0x0c
const REG_GPIO_DRV_L = 0x13
const REG_GPIO_DRV_H = 0x14
const REG_LED_CFG = 0x24
const REG_LED_RAM_START = 0x30

export const PY32_LED_MAX_COUNT = 32
const PY32_INIT_RETRY_COUNT = 24
const PY32_INIT_RETRY_DELAY_MS = 50

type I2COptions = {
  io: new (options: Record<string, unknown>) => I2CIO
  address?: number
  hz?: number
  [key: string]: unknown
}

type I2CIO = {
  readUint8(register: number): number
  writeUint8(register: number, byte: number): void
  writeBuffer(register: number, buffer: Uint8Array): void
  close?: () => void
}

type PY32Options = {
  /**
   * options.address overrides sensor.address; both fall back to DEFAULT_ADDRESS before sensor.io is constructed.
   */
  sensor?: I2COptions
  address?: number
}

type DeviceEnvironment = {
  Timer?: {
    delay: (milliseconds: number) => void
  }
  device?: {
    I2C?: {
      internal?: Record<string, unknown>
    }
    io?: {
      SMBus?: new (options: Record<string, unknown>) => I2CIO
    }
  }
}

const globalEnv = globalThis as typeof globalThis & DeviceEnvironment

function delayForRetry(milliseconds: number) {
  if (globalEnv.Timer?.delay) {
    globalEnv.Timer.delay(milliseconds)
    return
  }
  const deadline = Date.now() + milliseconds
  while (Date.now() < deadline) {}
}

function registerPair(pin: number, low: number, high: number) {
  if (pin < 0 || pin > 13) {
    throw new RangeError(`PY32 GPIO pin out of range: ${pin}`)
  }
  return pin < 8 ? { register: low, mask: 1 << pin } : { register: high, mask: 1 << (pin - 8) }
}

function createDefaultSensorOptions(address: number): I2COptions {
  const io = globalEnv.device?.io?.SMBus
  if (!io) {
    throw new Error('device.io.SMBus is not available')
  }
  return {
    ...(globalEnv.device?.I2C?.internal ?? {}),
    io,
    address,
    hz: 100_000,
  }
}

export function rgbToRgb565(r: number, g: number, b: number): number {
  return ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3)
}

export function normalizeLedRange(length: number, index?: number, count?: number) {
  const start = Math.max(0, Math.min(length, index ?? 0))
  const size = Math.max(0, Math.min(length - start, count ?? length - start))
  return { start, size, end: start + size }
}

export class PY32IOExpander {
  #io: I2CIO
  #initialized = false

  constructor(options: PY32Options = {}) {
    const address = options.address ?? options.sensor?.address ?? DEFAULT_ADDRESS
    const sensor = options.sensor ?? createDefaultSensorOptions(address)
    this.#io = new sensor.io({
      ...sensor,
      address,
    })
  }

  begin() {
    const version = this.readRegister8(REG_VERSION)
    if (version === 0 || version === 0xff) {
      trace(`[py32] invalid version: 0x${version.toString(16)}\n`)
      return false
    }
    trace(`[py32] version: 0x${version.toString(16)}\n`)
    this.#initialized = true
    return true
  }

  get initialized() {
    return this.#initialized
  }

  close() {
    this.#io.close?.()
  }

  readRegister8(register: number) {
    return this.#io.readUint8(register)
  }

  writeRegister8(register: number, value: number) {
    this.#io.writeUint8(register, value & 0xff)
  }

  writeRegister(register: number, data: Uint8Array) {
    this.#io.writeBuffer(register, data)
  }

  #writeBit(low: number, high: number, pin: number, enabled: boolean) {
    const { register, mask } = registerPair(pin, low, high)
    const value = this.readRegister8(register)
    this.writeRegister8(register, enabled ? value | mask : value & ~mask)
  }

  setDirection(pin: number, output: boolean) {
    this.#writeBit(REG_GPIO_M_L, REG_GPIO_M_H, pin, output)
  }

  setPullMode(pin: number, pullUp: boolean) {
    this.#writeBit(REG_GPIO_PD_L, REG_GPIO_PD_H, pin, !pullUp)
    this.#writeBit(REG_GPIO_PU_L, REG_GPIO_PU_H, pin, pullUp)
  }

  setDriveMode(pin: number, openDrain: boolean) {
    this.#writeBit(REG_GPIO_DRV_L, REG_GPIO_DRV_H, pin, openDrain)
  }

  digitalWrite(pin: number, level: boolean) {
    this.#writeBit(REG_GPIO_O_L, REG_GPIO_O_H, pin, level)
  }

  getWriteValue(pin: number) {
    const { register, mask } = registerPair(pin, REG_GPIO_O_L, REG_GPIO_O_H)
    return (this.readRegister8(register) & mask) !== 0
  }

  setLedCount(count: number) {
    this.writeRegister8(REG_LED_CFG, Math.max(0, Math.min(PY32_LED_MAX_COUNT, count)) & 0x3f)
  }

  setLedColor(index: number, r: number, g: number, b: number) {
    if (index < 0 || index >= PY32_LED_MAX_COUNT) {
      return
    }
    const color = rgbToRgb565(r, g, b)
    this.writeRegister(REG_LED_RAM_START + index * 2, Uint8Array.of(color & 0xff, (color >> 8) & 0xff))
  }

  refreshLeds() {
    this.writeRegister8(REG_LED_CFG, this.readRegister8(REG_LED_CFG) | (1 << 6))
  }
}

let sharedExpander: PY32IOExpander | undefined

export function getSharedPY32IOExpander(options?: PY32Options) {
  if (!sharedExpander) {
    let lastError: unknown
    for (let attempt = 0; attempt <= PY32_INIT_RETRY_COUNT; attempt++) {
      let expander: PY32IOExpander | undefined
      try {
        expander = new PY32IOExpander(options)
        if (expander.begin()) {
          sharedExpander = expander
          return sharedExpander
        }
        lastError = new Error('PY32 IO Expander did not respond')
      } catch (error) {
        lastError = error
      }
      expander?.close()
      if (attempt < PY32_INIT_RETRY_COUNT) {
        delayForRetry(PY32_INIT_RETRY_DELAY_MS)
      }
    }
    throw lastError
  }
  return sharedExpander
}
