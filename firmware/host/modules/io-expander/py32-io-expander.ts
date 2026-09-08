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
type PY32ErrorCallback = (error: unknown) => void

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

function delayForRetry(milliseconds: number) {
  const environment = globalThis as typeof globalThis & DeviceEnvironment
  if (environment.Timer?.delay) {
    environment.Timer.delay(milliseconds)
    return
  }
  const deadline = Date.now() + milliseconds
  while (Date.now() < deadline) {}
}

function registerPair(pin: number, low: number, high: number) {
  if (!Number.isInteger(pin) || pin < 0 || pin > 13) {
    throw new RangeError(`PY32 GPIO pin out of range: ${pin}`)
  }
  return pin < 8 ? { register: low, mask: 1 << pin } : { register: high, mask: 1 << (pin - 8) }
}

function createDefaultSensorOptions(address: number): I2COptions {
  // Resolve globals at runtime: preloading a captured global object snapshots the
  // board provider before runtime setup has installed it.
  const environment = globalThis as typeof globalThis & DeviceEnvironment
  const io = environment.device?.io?.SMBus
  if (!io) {
    throw new Error('device.io.SMBus is not available')
  }
  return {
    ...(environment.device?.I2C?.internal ?? {}),
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

abstract class PY32Registers {
  abstract readRegister8(register: number): number
  abstract writeRegister8(register: number, value: number): void
  abstract writeRegister(register: number, data: Uint8Array): void

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

export class PY32IOExpander extends PY32Registers {
  #io?: I2CIO
  #initialized = false

  constructor(options: PY32Options = {}) {
    super()
    const settings = resolveSensorOptions(options)
    this.#io = new settings.io(settings)
  }

  begin(): boolean {
    this.#initialized = false
    const version = this.readRegister8(REG_VERSION)
    if (version === 0 || version === 0xff) {
      trace(`[py32] invalid version: 0x${version.toString(16)}\n`)
      return false
    }
    trace(`[py32] version: 0x${version.toString(16)}\n`)
    this.#initialized = true
    return true
  }

  get initialized(): boolean {
    return this.#initialized
  }

  close(): void {
    const io = this.#io
    if (!io) return
    this.#io = undefined
    this.#initialized = false
    io.close?.()
  }

  #requireIO(): I2CIO {
    if (!this.#io) throw new Error('PY32 IO Expander is closed')
    return this.#io
  }

  readRegister8(register: number): number {
    return this.#requireIO().readUint8(register)
  }
  writeRegister8(register: number, value: number): void {
    this.#requireIO().writeUint8(register, value & 0xff)
  }
  writeRegister(register: number, data: Uint8Array): void {
    this.#requireIO().writeBuffer(register, data)
  }
}

function resolveSensorOptions(options: PY32Options = {}): I2COptions {
  const address = options.address ?? options.sensor?.address ?? DEFAULT_ADDRESS
  if (!Number.isInteger(address) || address < 0x08 || address > 0x77) throw new RangeError('invalid PY32 I2C address')
  return { ...(options.sensor ?? createDefaultSensorOptions(address)), address }
}

function sameSettings(first: I2COptions, second: I2COptions): boolean {
  const keys = Object.keys(first).filter((key) => first[key] !== undefined)
  const other = Object.keys(second).filter((key) => second[key] !== undefined)
  return keys.length === other.length && keys.every((key) => first[key] === second[key])
}

type SharedEntry = {
  settings: I2COptions
  expander?: PY32IOExpander
  leases: number
  releasing: boolean
  failed: boolean
}

/** A lease exposes register commands without granting ownership of another user's IO. */
export class PY32IOExpanderLease extends PY32Registers {
  #expander?: PY32IOExpander
  #release?: () => void
  constructor(expander: PY32IOExpander, release: () => void) {
    super()
    this.#expander = expander
    this.#release = release
  }
  get closed(): boolean {
    return !this.#expander
  }
  get initialized(): boolean {
    return this.#expander?.initialized ?? false
  }
  #requireExpander(): PY32IOExpander {
    if (!this.#expander) throw new Error('PY32 IO Expander lease is closed')
    return this.#expander
  }
  begin(): boolean {
    return this.#requireExpander().begin()
  }
  readRegister8(register: number): number {
    return this.#requireExpander().readRegister8(register)
  }
  writeRegister8(register: number, value: number): void {
    this.#requireExpander().writeRegister8(register, value)
  }
  writeRegister(register: number, data: Uint8Array): void {
    this.#requireExpander().writeRegister(register, data)
  }
  close(): void {
    if (!this.#expander) return
    this.#expander = undefined
    const release = this.#release
    this.#release = undefined
    release()
  }
}

/** One board's PY32, shared by LED output and servo power. */
export class PY32IOExpanderRegistry {
  #entry?: SharedEntry

  acquire(options?: PY32Options): PY32IOExpanderLease {
    const settings = resolveSensorOptions(options)
    let entry = this.#entry
    if (entry) {
      if (!sameSettings(entry.settings, settings)) throw new Error('shared PY32 I2C configuration mismatch')
      if (entry.failed || entry.releasing) throw new Error('PY32 IO cleanup failed or is in progress; restart the host')
      if (!entry.expander) throw new Error('PY32 initialization is already in progress')
    } else {
      entry = { settings, leases: 0, releasing: false, failed: false }
      this.#entry = entry
      try {
        entry.expander = this.#initialize(entry)
      } catch (error) {
        if (!entry.failed) this.#entry = undefined
        throw error
      }
    }
    entry.leases++
    const owned = entry
    return new PY32IOExpanderLease(entry.expander, () => this.#release(owned))
  }

  #initialize(entry: SharedEntry): PY32IOExpander {
    let lastError: unknown
    for (let attempt = 0; attempt <= PY32_INIT_RETRY_COUNT; attempt++) {
      let expander: PY32IOExpander | undefined
      try {
        expander = new PY32IOExpander({ sensor: entry.settings })
        if (expander.begin()) return expander
        lastError = new Error('PY32 IO Expander did not respond')
      } catch (error) {
        lastError = error
      }
      try {
        expander?.close()
      } catch {
        // Do not retry acquisition after an uncertain physical close.
        entry.failed = true
        throw lastError
      }
      if (attempt < PY32_INIT_RETRY_COUNT) delayForRetry(PY32_INIT_RETRY_DELAY_MS)
    }
    throw lastError
  }

  #release(entry: SharedEntry): void {
    if (--entry.leases !== 0) return
    entry.releasing = true
    try {
      entry.expander.close()
      this.#entry = undefined
    } catch (error) {
      entry.failed = true
      throw error
    }
  }
}

let registry: PY32IOExpanderRegistry | undefined

export function acquireSharedPY32IOExpander(options?: PY32Options): PY32IOExpanderLease {
  registry ??= new PY32IOExpanderRegistry()
  return registry.acquire(options)
}

export function tryAcquireSharedPY32IOExpander(
  options?: PY32Options,
  onError?: PY32ErrorCallback,
): PY32IOExpanderLease | undefined {
  try {
    return acquireSharedPY32IOExpander(options)
  } catch (error) {
    onError?.(error)
    return undefined
  }
}
