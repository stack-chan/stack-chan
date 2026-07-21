import assert from 'node:assert/strict'
import test from 'node:test'
import {
  decodeStackChanFrame,
  encodeStackChanFrame,
  STACKCHAN_CAPABILITIES,
  StackChanCapability,
  StackChanControl,
  StackChanFrameParser,
  StackChanFrameType,
  StackChanStatus,
} from './protocol.js'

test('StackChan advertises sentence captions as an optional capability', () => {
  assert.equal(StackChanControl.SPEAKER_TEXT, 37)
  assert.notEqual(STACKCHAN_CAPABILITIES & StackChanCapability.SPEAKER_TEXT, 0)
})

test('StackChan advertises recognizing and speaking status icons', () => {
  assert.equal(StackChanControl.STATUS, 48)
  assert.equal(StackChanStatus.RECOGNIZING, 1)
  assert.equal(StackChanStatus.SPEAKING, 2)
  assert.notEqual(STACKCHAN_CAPABILITIES & StackChanCapability.STATUS_ICON, 0)
})

test('StackChan frame round trips with the Android wire layout', () => {
  const encoded = encodeStackChanFrame({
    type: StackChanFrameType.SPEAKER_PCM,
    flags: StackChanControl.SPEAKER_START,
    sequence: 42,
    sampleRate: 24000,
    payload: Uint8Array.of(1, 2, 3, 4),
  })
  assert.deepEqual(Array.from(encoded.slice(0, 4)), [0x43, 0x53, 1, 2])
  assert.equal(Buffer.from(encoded).toString('hex'), '43530102200000002a000000c05d0000040000000102030403a97e55')
  assert.deepEqual(decodeStackChanFrame(encoded), {
    type: StackChanFrameType.SPEAKER_PCM,
    flags: StackChanControl.SPEAKER_START,
    sequence: 42,
    sampleRate: 24000,
    payload: Uint8Array.of(1, 2, 3, 4),
  })
})

test('StackChan parser accepts fragmented and coalesced frames', () => {
  const first = encodeStackChanFrame({ type: StackChanFrameType.CONTROL, flags: StackChanControl.HELLO, sequence: 0 })
  const second = encodeStackChanFrame({
    type: StackChanFrameType.MICROPHONE_PCM,
    sequence: 0,
    sampleRate: 16000,
    payload: Uint8Array.of(1, 2),
  })
  const parser = new StackChanFrameParser()
  assert.deepEqual(parser.push(first.slice(0, 7)), [])
  const joined = new Uint8Array(first.byteLength - 7 + second.byteLength)
  joined.set(first.slice(7))
  joined.set(second, first.byteLength - 7)
  assert.equal(parser.push(joined).length, 2)
})

test('StackChan parser resynchronizes after corrupt data', () => {
  const corrupt = encodeStackChanFrame({
    type: StackChanFrameType.MICROPHONE_PCM,
    sequence: 0,
    payload: Uint8Array.of(1, 2),
  })
  corrupt[20] ^= 1
  const valid = encodeStackChanFrame({
    type: StackChanFrameType.CONTROL,
    flags: StackChanControl.MIC_STOPPED,
    sequence: 1,
  })
  const joined = new Uint8Array(3 + corrupt.byteLength + valid.byteLength)
  joined.set([9, 8, 7])
  joined.set(corrupt, 3)
  joined.set(valid, 3 + corrupt.byteLength)
  const frames = new StackChanFrameParser().push(joined)
  assert.equal(frames.length, 1)
  assert.equal(frames[0].flags, StackChanControl.MIC_STOPPED)
})
