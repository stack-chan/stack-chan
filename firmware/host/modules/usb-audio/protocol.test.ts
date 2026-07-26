import assert from 'node:assert/strict'
import test from 'node:test'
import { installUsbAudioTestAliases } from './__tests__/node-aliases.js'

installUsbAudioTestAliases()

const {
  decodeStackChanFrame,
  encodeStackChanFrame,
  STACKCHAN_CAPABILITIES,
  STACKCHAN_PROTOCOL_VERSION,
  StackChanCapability,
  StackChanControl,
  StackChanErrorCode,
  StackChanEventDecoder,
  StackChanEventEncoder,
  StackChanEventFlag,
  StackChanFrameParser,
  StackChanFrameType,
  StackChanStatus,
} = await import('./protocol.js')

test('StackChan reports distinct speaker receive failures', () => {
  assert.equal(StackChanErrorCode.SPEAKER_SEQUENCE_MISMATCH, 6)
  assert.equal(StackChanErrorCode.SPEAKER_BUFFER_OVERFLOW, 7)
  assert.equal(StackChanErrorCode.CAPTION_QUEUE_OVERFLOW, 8)
})

test('StackChan advertises sentence captions as an optional capability', () => {
  assert.equal(StackChanControl.SPEAKER_TEXT, 37)
  assert.notEqual(STACKCHAN_CAPABILITIES & StackChanCapability.SPEAKER_TEXT, 0)
})

test('StackChan advertises recognizing and speaking status icons', () => {
  assert.equal(StackChanControl.STATUS, 48)
  assert.equal(StackChanStatus.RECOGNIZING, 1)
  assert.equal(StackChanStatus.SPEAKING, 2)
  assert.equal(StackChanStatus.LISTENING, 3)
  assert.equal(StackChanStatus.CONNECTING, 4)
  assert.equal(StackChanStatus.ERROR, 5)
  assert.notEqual(STACKCHAN_CAPABILITIES & StackChanCapability.STATUS_ICON, 0)
  assert.equal(StackChanCapability.STATUS_EXTENDED, 1 << 11)
  assert.notEqual(STACKCHAN_CAPABILITIES & StackChanCapability.STATUS_EXTENDED, 0)
})

test('StackChan advertises negotiated application EVENT support', () => {
  assert.equal(StackChanFrameType.EVENT, 6)
  assert.equal(StackChanCapability.EVENT, 1 << 10)
  assert.notEqual(STACKCHAN_CAPABILITIES & StackChanCapability.EVENT, 0)
})

test('StackChan frame round trips with the Android wire layout', () => {
  const encoded = encodeStackChanFrame({
    type: StackChanFrameType.SPEAKER_PCM,
    flags: StackChanControl.SPEAKER_START,
    streamId: 1,
    sequence: 42,
    sampleRate: 24000,
    payload: Uint8Array.of(1, 2, 3, 4),
  })
  assert.deepEqual(Array.from(encoded.slice(0, 4)), [0x43, 0x53, 2, 2])
  assert.deepEqual(decodeStackChanFrame(encoded), {
    type: StackChanFrameType.SPEAKER_PCM,
    flags: StackChanControl.SPEAKER_START,
    streamId: 1,
    sequence: 42,
    sampleRate: 24000,
    payload: Uint8Array.of(1, 2, 3, 4),
  })
})

test('StackChan protocol v2 requires and round trips stream IDs', () => {
  const encoded = encodeStackChanFrame({
    type: StackChanFrameType.SPEAKER_PCM,
    streamId: 0x0201,
    sequence: 7,
    sampleRate: 24000,
    payload: Uint8Array.of(1, 2),
  })

  assert.equal(STACKCHAN_PROTOCOL_VERSION, 2)
  assert.deepEqual(Array.from(encoded.slice(6, 8)), [0x01, 0x02])
  assert.equal(decodeStackChanFrame(encoded).streamId, 0x0201)
  assert.notEqual(STACKCHAN_CAPABILITIES & StackChanCapability.STREAM_ID, 0)
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

test('StackChan EVENT payload round trips across chunks', () => {
  const source = new TextEncoder().encode(JSON.stringify({ type: 'session.update', instructions: 'こんにちは' }))
  const frames = new StackChanEventEncoder().encode(source, 7)
  const decoder = new StackChanEventDecoder()
  for (const frame of frames.slice(0, -1)) assert.equal(decoder.push(frame), undefined)
  const last = frames.at(-1)
  assert.ok(last)
  assert.deepEqual(decoder.push(last), source)
  assert.equal(frames[0].flags, StackChanEventFlag.START)
  assert.equal(last.flags, StackChanEventFlag.END)
})

test('StackChan EVENT decoder rejects a missing chunk', () => {
  const frames = new StackChanEventEncoder().encode(new Uint8Array(30), 10)
  const decoder = new StackChanEventDecoder()
  decoder.push(frames[0])
  assert.throws(() => decoder.push(frames[2]), /sequence mismatch/)
})

test('StackChan EVENT encoder restarts message IDs after a transport reset', () => {
  const encoder = new StackChanEventEncoder()
  assert.equal(encoder.encode(new Uint8Array(0))[0].streamId, 1)
  assert.equal(encoder.encode(new Uint8Array(0))[0].streamId, 2)
  encoder.reset()
  assert.equal(encoder.encode(new Uint8Array(0))[0].streamId, 1)
})
