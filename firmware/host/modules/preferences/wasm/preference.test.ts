import assert from 'node:assert/strict'
import { test } from 'node:test'

import Preference from './preference.js'

test('wasm preferences accept the value types supported by embedded targets', () => {
  const buffer = new ArrayBuffer(4)
  const values = [true, 42, '0.46', buffer] as const

  for (const [index, value] of values.entries()) {
    const key = `supported-${index}`
    Preference.set('test', key, value)
    assert.equal(Preference.get('test', key), value)
    Preference.delete('test', key)
  }
})

test('wasm preferences reject fractional numbers like the ESP32 implementation', () => {
  assert.throws(() => Preference.set('test', 'volume', 0.46), /float unsupported/)
  assert.equal(Preference.get('test', 'volume'), undefined)
})

test('wasm preferences reject unsupported values', () => {
  assert.throws(() => Preference.set('test', 'object', {}), /unsupported type/)
  assert.equal(Preference.get('test', 'object'), undefined)
})
