import assert from 'node:assert/strict'
import test from 'node:test'

import SingleWaitSlot from '../internal/single-wait-slot.js'

test('SingleWaitSlot releases the slot after timeout', async () => {
  let scheduled: (() => void) | null = null
  const handles: unknown[] = []
  const slot = new SingleWaitSlot<number[]>(
    (handler) => {
      scheduled = handler
      const handle = Symbol('timer')
      handles.push(handle)
      return handle
    },
    () => {
      handles.push('cleared')
    },
  )

  const promise = slot.wait(10)
  assert.equal(slot.isWaiting, true)
  assert.ok(scheduled, 'timer handler should be scheduled')
  scheduled?.()

  const result = await promise
  assert.equal(result, undefined)
  assert.equal(slot.isWaiting, false)
  assert.equal(handles.length, 1)
  assert.equal(typeof handles[0], 'symbol')
})

test('SingleWaitSlot clears timer when resolving explicitly', async () => {
  let scheduled: (() => void) | null = null
  let clearedHandle: unknown = null
  const timerHandle = Symbol('timer')
  const slot = new SingleWaitSlot<number[]>(
    (handler) => {
      scheduled = handler
      return timerHandle
    },
    (handle) => {
      clearedHandle = handle
    },
  )

  const promise = slot.wait(10)
  assert.equal(slot.isWaiting, true)
  assert.ok(scheduled, 'timer handler should be scheduled')

  slot.resolve([1, 2, 3])

  const result = await promise
  assert.deepEqual(result, [1, 2, 3])
  assert.equal(slot.isWaiting, false)
  assert.equal(clearedHandle, timerHandle)

  // resolving again should be ignored
  slot.resolve([4, 5, 6])
  assert.equal(slot.isWaiting, false)
})
