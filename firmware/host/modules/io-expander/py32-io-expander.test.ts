import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  acquireSharedPY32IOExpander,
  getSharedPY32IOExpander,
  normalizeLedRange,
  PY32IOExpander,
  PY32IOExpanderRegistry,
  rgbToRgb565,
} from './py32-io-expander.js'

describe('PY32 IO Expander helpers', () => {
  it('converts RGB888 to RGB565 in the same layout as the reference firmware', () => {
    assert.equal(rgbToRgb565(255, 0, 0), 0xf800)
    assert.equal(rgbToRgb565(0, 255, 0), 0x07e0)
    assert.equal(rgbToRgb565(0, 0, 255), 0x001f)
    assert.equal(rgbToRgb565(255, 255, 255), 0xffff)
  })

  it('normalizes LED ranges within the configured strip length', () => {
    assert.deepEqual(normalizeLedRange(12), { start: 0, size: 12, end: 12 })
    assert.deepEqual(normalizeLedRange(12, 10, 10), { start: 10, size: 2, end: 12 })
    assert.deepEqual(normalizeLedRange(12, -3, 4), { start: 0, size: 4, end: 4 })
    assert.deepEqual(normalizeLedRange(12, 15, 4), { start: 12, size: 0, end: 12 })
  })

  it('retries PY32 initialization before sharing the expander', () => {
    let reads = 0
    let closes = 0
    let delays = 0
    const globalWithModdableHooks = globalThis as typeof globalThis & {
      Timer?: { delay: (milliseconds: number) => void }
      trace?: (message: string) => void
    }
    const previousTimer = globalWithModdableHooks.Timer
    const previousTrace = globalWithModdableHooks.trace
    globalWithModdableHooks.Timer = { delay: () => delays++ }
    globalWithModdableHooks.trace = () => {}

    try {
      class FakeIO {
        readUint8(_register: number) {
          reads++
          return reads < 3 ? 0xff : 0x41
        }
        writeUint8(_register: number, _byte: number) {}
        writeBuffer(_register: number, _buffer: Uint8Array) {}
        close() {
          closes++
        }
      }

      const expander = getSharedPY32IOExpander({ sensor: { io: FakeIO } })

      assert.equal(expander.initialized, true)
      assert.equal(reads, 3)
      assert.equal(closes, 2)
      assert.equal(delays, 2)
      expander.close()
      assert.equal(closes, 3)
    } finally {
      globalWithModdableHooks.Timer = previousTimer
      globalWithModdableHooks.trace = previousTrace
    }
  })
})

function withHooks(run: (delays: number[]) => void): void {
  const env = globalThis as typeof globalThis & {
    trace?: (message: string) => void
    Timer?: { delay: (ms: number) => void }
  }
  const previousTrace = env.trace
  const previousTimer = env.Timer
  const delays: number[] = []
  env.trace = () => {}
  env.Timer = { delay: (ms) => delays.push(ms) }
  try {
    run(delays)
  } finally {
    env.trace = previousTrace
    env.Timer = previousTimer
  }
}

function fixture() {
  const instances: FakeIO[] = []
  class FakeIO {
    closes = 0
    registers = new Uint8Array(256)
    readError?: Error
    closeError?: Error
    onClose?: () => void
    constructor(readonly options: Record<string, unknown>) {
      this.registers[2] = 0x41
      instances.push(this)
    }
    readUint8(register: number): number {
      if (this.readError) throw this.readError
      return this.registers[register]
    }
    writeUint8(register: number, value: number): void {
      this.registers[register] = value
    }
    writeBuffer(register: number, buffer: Uint8Array): void {
      this.registers.set(buffer, register)
    }
    close(): void {
      this.closes++
      this.onClose?.()
      if (this.closeError) throw this.closeError
    }
  }
  const registry = new PY32IOExpanderRegistry()
  const options = { sensor: { io: FakeIO, data: 12, clock: 13, hz: 100_000 } }
  return { registry, options, instances, FakeIO }
}

describe('PY32 shared ownership', () => {
  it('rejects invalid GPIO pins before changing registers', () =>
    withHooks(() => {
      const f = fixture()
      const lease = f.registry.acquire(f.options)
      const before = f.instances[0].registers.slice()
      for (const pin of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, 14]) {
        assert.throws(() => lease.digitalWrite(pin, true), RangeError)
        assert.throws(() => lease.setDirection(pin, true), RangeError)
      }
      assert.deepEqual(f.instances[0].registers, before)
      lease.close()
    }))
  it('repeats 100 shared lifetimes and closes IO only after both users release it', () =>
    withHooks(() => {
      const f = fixture()
      for (let cycle = 0; cycle < 100; cycle++) {
        const led = f.registry.acquire(f.options)
        const power = f.registry.acquire(f.options)
        assert.equal(f.instances.length, cycle + 1)
        led.setLedColor(0, 255, 0, 0)
        led.close()
        led.close()
        assert.equal(f.instances[cycle].closes, 0)
        assert.throws(() => led.digitalWrite(0, true), /closed/)
        power.digitalWrite(0, true)
        assert.equal(power.getWriteValue(0), true)
        power.close()
        power.close()
        assert.equal(f.instances[cycle].closes, 1)
        assert.equal(power.initialized, false)
      }
    }))

  it('validates shared IO configuration before acquiring another handle', () =>
    withHooks(() => {
      const f = fixture()
      assert.throws(() => f.registry.acquire({ ...f.options, address: 1 }), /address/)
      assert.equal(f.instances.length, 0)
      const lease = f.registry.acquire(f.options)
      for (const sensor of [
        { ...f.options.sensor, hz: 400_000 },
        { ...f.options.sensor, data: 14 },
      ]) {
        assert.throws(() => f.registry.acquire({ sensor }), /configuration mismatch/)
      }
      assert.throws(() => f.registry.acquire({ ...f.options, address: 0x70 }), /configuration mismatch/)
      assert.equal(f.instances.length, 1)
      lease.close()
      f.registry.acquire({ ...f.options, address: 0x70 }).close()
      assert.equal(f.instances.length, 2)
      assert.equal(f.instances[1].options.address, 0x70)
    }))

  it('retains a reservation after uncertain physical close and ignores repeated lease close', () =>
    withHooks(() => {
      const f = fixture()
      const lease = f.registry.acquire(f.options)
      f.instances[0].closeError = new Error('physical close failed')
      assert.throws(() => lease.close(), /physical close failed/)
      lease.close()
      assert.equal(f.instances[0].closes, 1)
      assert.throws(() => f.registry.acquire(f.options), /restart the host/)
      assert.equal(f.instances.length, 1)
    }))

  it('does not reopen during physical release', () =>
    withHooks(() => {
      const f = fixture()
      const lease = f.registry.acquire(f.options)
      f.instances[0].onClose = () => assert.throws(() => f.registry.acquire(f.options), /in progress/)
      lease.close()
      f.registry.acquire(f.options).close()
      assert.equal(f.instances.length, 2)
    }))

  it('preserves initialization failure and stops retrying if cleanup also fails', () =>
    withHooks((delays) => {
      const f = fixture()
      const original = new Error('initial read failed')
      class BrokenIO extends f.FakeIO {
        constructor(options: Record<string, unknown>) {
          super(options)
          this.readError = original
          this.closeError = new Error('cleanup failed')
        }
      }
      const options = { sensor: { io: BrokenIO } }
      assert.throws(
        () => f.registry.acquire(options),
        (error) => error === original,
      )
      assert.equal(f.instances.length, 1)
      assert.equal(f.instances[0].closes, 1)
      assert.equal(delays.length, 0)
      assert.throws(() => f.registry.acquire(options), /restart the host/)
    }))

  it('legacy callers share their own lease without owning newer consumers IO', () =>
    withHooks(() => {
      const f = fixture()
      const legacy = getSharedPY32IOExpander(f.options)
      assert.equal(getSharedPY32IOExpander(f.options), legacy)
      const owner = acquireSharedPY32IOExpander(f.options)
      legacy.close()
      assert.equal(f.instances[0].closes, 0)
      owner.digitalWrite(0, true)
      assert.equal(owner.getWriteValue(0), true)
      owner.close()
      assert.equal(f.instances[0].closes, 1)
      const next = getSharedPY32IOExpander(f.options)
      assert.notEqual(next, legacy)
      next.close()
    }))

  it('direct physical owners close once and reject register access after close', () =>
    withHooks(() => {
      const f = fixture()
      const physical = new PY32IOExpander(f.options)
      physical.begin()
      physical.close()
      physical.close()
      assert.equal(physical.initialized, false)
      assert.equal(f.instances[0].closes, 1)
      assert.throws(() => physical.begin(), /closed/)
      assert.throws(() => physical.readRegister8(2), /closed/)
    }))
})
