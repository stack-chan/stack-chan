import assert from 'node:assert/strict'
import { test } from 'node:test'

import { SharedByteRing } from '../platforms/m5stackchan-cores3/shared-byte-ring.js'

function write(ring: SharedByteRing, values: number[]): void {
  let offset = 0
  while (offset < values.length) {
    const view = ring.writableView(values.length - offset)
    assert.notEqual(view.byteLength, 0)
    view.set(values.slice(offset, offset + view.byteLength))
    ring.advanceWrite(view.byteLength)
    offset += view.byteLength
  }
}

function read(ring: SharedByteRing, count: number): number[] {
  const result: number[] = []
  while (result.length < count) {
    const view = ring.readableView(count - result.length)
    assert.notEqual(view.byteLength, 0)
    result.push(...view)
    ring.advanceRead(view.byteLength)
  }
  return result
}

test('SharedByteRing preserves bytes across wraparound', () => {
  const producer = SharedByteRing.allocate(8)
  const buffers = producer.buffers
  const consumer = new SharedByteRing(buffers.data, buffers.state)

  write(producer, [1, 2, 3, 4, 5])
  assert.deepEqual(read(consumer, 3), [1, 2, 3])
  write(producer, [6, 7, 8, 9, 10])

  assert.equal(producer.writableBytes, 0)
  assert.equal(consumer.readableBytes, 7)
  assert.deepEqual(read(consumer, 7), [4, 5, 6, 7, 8, 9, 10])
  assert.equal(producer.readableBytes, 0)
  assert.equal(consumer.writableBytes, 7)
})

test('SharedByteRing rejects invalid advances', () => {
  const ring = SharedByteRing.allocate(4)
  assert.throws(() => ring.advanceRead(1), /beyond.*contents/)
  assert.throws(() => ring.advanceWrite(4), /beyond.*capacity/)
  assert.throws(() => ring.advanceWrite(-1), /beyond.*capacity/)
})
