import assert from 'node:assert/strict'
import test from 'node:test'
import { StackChanControl, StackChanFrameType } from './protocol.js'
import { StreamTxQueue } from './stream-tx-queue.js'

test('drops queued credit and diagnostics for a finished stream while retaining terminal controls', () => {
  const queue = new StreamTxQueue(1024)
  queue.enqueue(Uint8Array.of(1, 1), StackChanFrameType.CONTROL, StackChanControl.SPEAKER_CREDIT, 1)
  queue.enqueue(Uint8Array.of(1, 2), StackChanFrameType.CONTROL, StackChanControl.SPEAKER_DONE, 1)
  queue.enqueue(Uint8Array.of(2, 1), StackChanFrameType.CONTROL, StackChanControl.SPEAKER_CREDIT, 2)
  queue.enqueue(Uint8Array.of(1, 3), StackChanFrameType.DIAGNOSTICS, 0, 1)

  queue.dropSpeakerFlowFrames(1)

  assert.deepEqual(Array.from(queue.current() ?? []), [1, 2])
  queue.advance(2)
  assert.deepEqual(Array.from(queue.current() ?? []), [2, 1])
  assert.equal(queue.remainingBytes, 2)
})

test('keeps a partially transmitted frame to preserve wire framing', () => {
  const queue = new StreamTxQueue(1024)
  queue.enqueue(Uint8Array.of(1, 2, 3), StackChanFrameType.CONTROL, StackChanControl.SPEAKER_CREDIT, 1)
  queue.advance(1)

  queue.dropSpeakerFlowFrames(1)

  assert.deepEqual(Array.from(queue.current() ?? []), [2, 3])
})

test('drops queued microphone PCM before a terminal control while preserving other streams', () => {
  const queue = new StreamTxQueue(1024)
  queue.enqueue(Uint8Array.of(1, 1), StackChanFrameType.MICROPHONE_PCM, 0, 1)
  queue.enqueue(Uint8Array.of(2, 1), StackChanFrameType.MICROPHONE_PCM, 0, 2)
  queue.enqueue(Uint8Array.of(1, 2), StackChanFrameType.CONTROL, StackChanControl.MIC_STOPPED, 1)

  queue.dropMicrophoneFrames(1)

  assert.deepEqual(Array.from(queue.current() ?? []), [2, 1])
  queue.advance(2)
  assert.deepEqual(Array.from(queue.current() ?? []), [1, 2])
  assert.equal(queue.remainingBytes, 2)
})
