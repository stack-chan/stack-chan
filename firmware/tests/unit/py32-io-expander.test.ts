import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { getSharedPY32IOExpander, normalizeLedRange, rgbToRgb565 } from '../../stackchan/led/py32-io-expander.js'

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
    } finally {
      globalWithModdableHooks.Timer = previousTimer
      globalWithModdableHooks.trace = previousTrace
    }
  })
})
