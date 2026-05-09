import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { normalizeLedRange, rgbToRgb565 } from '../../stackchan/led/py32-io-expander.js'

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
})
