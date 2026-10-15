import assert from 'node:assert/strict'
import test from 'node:test'
import { ArtworkRing } from './artwork-ring.js'

test('ring wraps without overwriting unread data and publishes EOF/cancellation independently', () => {
  const ring = new ArtworkRing(new SharedArrayBuffer(8), new SharedArrayBuffer(16))
  ring.target(6).set([1, 2, 3, 4, 5, 6])
  ring.commit(6)
  assert.equal(ring.writable, 2)
  assert.throws(() => ring.commit(3), /overflow/)
  Atomics.store(ring.state, 1, 4)
  const tail = ring.target(6)
  assert.equal(tail.length, 2)
  tail.set([7, 8])
  ring.commit(2)
  ring.target(4).set([9, 10, 11, 12])
  ring.commit(4)
  assert.equal(ring.writable, 0)
  assert.deepEqual([...ring.bytes], [9, 10, 11, 12, 5, 6, 7, 8])
  ring.end()
  assert.equal(Atomics.load(ring.state, 2), 1)
  assert.equal(ring.cancelled, false)
  ring.cancel()
  assert.equal(ring.cancelled, true)
})

test('unsigned producer/consumer counters remain correct across integer wrap', () => {
  const ring = new ArtworkRing(new SharedArrayBuffer(8), new SharedArrayBuffer(16))
  Atomics.store(ring.state, 0, -2)
  Atomics.store(ring.state, 1, -4)
  assert.equal(ring.writable, 6)
  assert.equal(ring.target(6).length, 2)
  ring.commit(2)
  assert.equal(Atomics.load(ring.state, 0), 0)
  assert.equal(ring.writable, 4)
})
