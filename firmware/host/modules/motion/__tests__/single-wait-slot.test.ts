import assert from 'node:assert/strict'
import test from 'node:test'

import SingleWaitSlot from '../internal/single-wait-slot.js'

test('SingleWaitSlot releases the slot after timeout', () => {
  let scheduled: (() => void) | null = null
  let timedOut = false
  const handles: unknown[] = []
  let result: number[] | undefined
  let called = false
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

  assert.equal(
    slot.wait(
      10,
      (value) => {
        called = true
        result = value
      },
      () => {
        timedOut = true
      },
    ),
    true,
  )
  assert.equal(slot.isWaiting, true)
  assert.ok(scheduled, 'timer handler should be scheduled')
  scheduled?.()

  assert.equal(called, false)
  assert.equal(result, undefined)
  assert.equal(timedOut, true)
  assert.equal(slot.isWaiting, false)
  assert.equal(handles.length, 1)
  assert.equal(typeof handles[0], 'symbol')
})

test('SingleWaitSlot clears timer when resolving explicitly', () => {
  let scheduled: (() => void) | null = null
  let clearedHandle: unknown = null
  let result: number[] | undefined
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

  assert.equal(
    slot.wait(10, (value) => {
      result = value
    }),
    true,
  )
  assert.equal(slot.isWaiting, true)
  assert.ok(scheduled, 'timer handler should be scheduled')

  slot.resolve([1, 2, 3])

  assert.deepEqual(result, [1, 2, 3])
  assert.equal(slot.isWaiting, false)
  assert.equal(clearedHandle, timerHandle)

  // resolving again should be ignored
  slot.resolve([4, 5, 6])
  assert.equal(slot.isWaiting, false)
})

test('SingleWaitSlot reports overlapping waits without queuing them', () => {
  const slot = new SingleWaitSlot<number[]>(
    () => Symbol('timer'),
    () => {},
  )

  assert.equal(
    slot.wait(10, () => {}),
    true,
  )

  assert.equal(
    slot.wait(10, () => {}),
    false,
  )
})
