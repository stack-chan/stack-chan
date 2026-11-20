import assert from 'node:assert/strict'
import { test } from 'node:test'

import { PayloadBuffer } from '../payload-buffer.js'

test('copyFrom reuses existing allocation when capacity is sufficient', () => {
  const buffer = new PayloadBuffer(4)
  const source = Uint8Array.from([1, 2, 3, 4])

  const firstView = buffer.copyFrom(source, 2)
  assert.equal(firstView.length, 2)
  assert.deepEqual(Array.from(firstView), [1, 2])
  const initialBuffer = firstView.buffer

  const secondView = buffer.copyFrom(source, 2, 2)
  assert.equal(secondView.length, 2)
  assert.deepEqual(Array.from(secondView), [3, 4])
  assert.strictEqual(secondView.buffer, initialBuffer)
})

test('copyFrom grows the allocation once when required and reuses it afterwards', () => {
  const buffer = new PayloadBuffer(1)
  const first = buffer.copyFrom(Uint8Array.from([5, 6, 7]), 3)
  assert.equal(first.length, 3)
  assert.deepEqual(Array.from(first), [5, 6, 7])
  const grown = first.buffer

  const second = buffer.copyFrom(Uint8Array.from([8]), 1)
  assert.equal(second.length, 1)
  assert.strictEqual(second.buffer, grown)
  assert.equal(second[0], 8)
})
