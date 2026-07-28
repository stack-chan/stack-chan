import assert from 'node:assert/strict'
import test from 'node:test'
import { UsbConnectionDebouncer } from './connection-state.js'

test('brief missing-SOF observations preserve the negotiated connection', () => {
  const connection = new UsbConnectionDebouncer(100)

  assert.deepEqual(connection.update(true, 1_000), { connected: true, changed: true })
  assert.deepEqual(connection.update(false, 1_010), { connected: true, changed: false })
  assert.deepEqual(connection.update(false, 1_109), { connected: true, changed: false })
  assert.deepEqual(connection.update(true, 1_110), { connected: true, changed: false })
  assert.equal(connection.connected, true)
})

test('continuous disconnection is confirmed at the debounce boundary', () => {
  const connection = new UsbConnectionDebouncer(100)

  connection.update(true, 1_000)
  assert.deepEqual(connection.update(false, 1_010), { connected: true, changed: false })
  assert.deepEqual(connection.update(false, 1_110), { connected: false, changed: true })
  assert.deepEqual(connection.update(false, 1_111), { connected: false, changed: false })
  assert.equal(connection.connected, false)
})

test('reconnection is immediate after a confirmed disconnection', () => {
  const connection = new UsbConnectionDebouncer(10)

  connection.update(true, 100)
  connection.update(false, 101)
  connection.update(false, 111)

  assert.deepEqual(connection.update(true, 112), { connected: true, changed: true })
  assert.deepEqual(connection.update(true, 113), { connected: true, changed: false })
})

test('disconnect timing remains correct when unsigned ticks wrap', () => {
  const connection = new UsbConnectionDebouncer(32)

  connection.update(true, 0xffff_ffe0)
  connection.update(false, 0xffff_fff0)
  assert.deepEqual(connection.update(false, 0x0000_000f), { connected: true, changed: false })
  assert.deepEqual(connection.update(false, 0x0000_0010), { connected: false, changed: true })
})

test('disconnect debounce requires a positive 31-bit integer', () => {
  for (const value of [0, -1, 1.5, Number.NaN, 0x8000_0000]) {
    assert.throws(() => new UsbConnectionDebouncer(value), /positive 31-bit integer/)
  }
})
