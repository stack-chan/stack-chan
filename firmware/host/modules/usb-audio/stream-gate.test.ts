import assert from 'node:assert/strict'
import test from 'node:test'
import { CurrentStreamGate } from './stream-gate.js'

test('late worker responses cannot affect a replacement stream', () => {
  const gate = new CurrentStreamGate()
  gate.activate(1)
  gate.activate(2)
  let mutations = 0

  assert.equal(
    gate.runIfCurrent(1, () => mutations++),
    false,
  )
  assert.equal(
    gate.runIfCurrent(2, () => mutations++),
    true,
  )
  assert.equal(mutations, 1)
})

test('only the current stream can clear worker state', () => {
  const gate = new CurrentStreamGate()
  gate.activate(7)

  assert.equal(gate.clearIfCurrent(6), false)
  assert.equal(gate.current, 7)
  assert.equal(gate.clearIfCurrent(7), true)
  assert.equal(gate.current, 0)
})
