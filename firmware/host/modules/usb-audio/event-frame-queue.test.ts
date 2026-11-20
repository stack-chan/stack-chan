import assert from 'node:assert/strict'
import test from 'node:test'
import { installUsbAudioTestAliases } from './__tests__/node-aliases.js'

installUsbAudioTestAliases()

const { BoundedEventFrameQueue, STACKCHAN_FRAME_OVERHEAD_BYTES } = await import('./event-frame-queue.js')
const { StackChanFrameType } = await import('./protocol.js')

function eventFrame(payloadBytes: number, sequence = 0) {
  return {
    type: StackChanFrameType.EVENT,
    streamId: 1,
    sequence,
    payload: new Uint8Array(payloadBytes),
  }
}

test('event frame queue rejects an entire event when its frame limit is full', () => {
  const queue = new BoundedEventFrameQueue(2, 1024)
  const first = eventFrame(10)
  const overflow = [eventFrame(10, 1), eventFrame(10, 2)]

  assert.equal(queue.tryEnqueue([first]), true)
  assert.equal(queue.tryEnqueue(overflow), false)
  assert.equal(queue.length, 1)
  assert.equal(queue.current(), first)
})

test('event frame queue accounts for wire overhead and releases capacity after advancing', () => {
  const frameBytes = STACKCHAN_FRAME_OVERHEAD_BYTES + 10
  const queue = new BoundedEventFrameQueue(2, frameBytes)
  const first = eventFrame(10)
  const second = eventFrame(10, 1)

  assert.equal(queue.tryEnqueue([first]), true)
  assert.equal(queue.remainingBytes, frameBytes)
  assert.equal(queue.tryEnqueue([second]), false)

  queue.advance()
  assert.equal(queue.remainingBytes, 0)
  assert.equal(queue.tryEnqueue([second]), true)
  assert.equal(queue.current(), second)
})
