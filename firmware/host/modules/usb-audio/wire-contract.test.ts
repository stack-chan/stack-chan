import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { installUsbAudioTestAliases } from './__tests__/node-aliases.js'
import type { StackChanFrame, StackChanFrameType as StackChanFrameTypeValue } from './protocol.js'

installUsbAudioTestAliases()

const { decodeStackChanFrame, encodeStackChanFrame, StackChanEventDecoder, StackChanFrameParser, StackChanFrameType } =
  await import('./protocol.js')

type WireVector = {
  name: string
  frame: {
    type: number
    flags: number
    streamId: number
    sequence: number
    sampleRate: number
    payloadHex: string
  }
  encodedHex: string
}

type WireFixture = {
  schema: string
  protocolVersion: number
  validFrames: WireVector[]
  invalidFrames: Array<{
    name: string
    reason: string
    encodedHex: string
  }>
}

type ParserFixture = {
  schema: string
  parserScenarios: {
    fragmentFrame: string
    coalescedFrames: string[]
    crcCorruptFrame: string
    recoveryFrame: string
  }
  eventSequenceMismatch: {
    streamId: number
    frames: Array<{ flags: number; sequence: number; payloadHex: string }>
    expectedError: string
  }
}

const fixture = JSON.parse(
  readFileSync('vendor/stack-chan-dock/contracts/usb-cdc-v2/test-vectors.json', 'utf8'),
) as WireFixture
const parserFixture = JSON.parse(
  readFileSync('host/modules/usb-audio/contracts/parser-scenarios-v2.json', 'utf8'),
) as ParserFixture
const frameByName = new Map(fixture.validFrames.map((vector) => [vector.name, vector]))
const invalidFrameByName = new Map(fixture.invalidFrames.map((vector) => [vector.name, vector]))

test('Dock canonical wire v2 vectors encode and decode byte-for-byte', () => {
  assert.equal(fixture.schema, 'stackchan.usb-cdc.test-vectors.v1')
  assert.equal(fixture.protocolVersion, 2)
  assert.equal(fixture.validFrames.length, 3)
  for (const vector of fixture.validFrames) {
    const frame = asFrame(vector)
    const encoded = encodeStackChanFrame(frame)
    assert.equal(Buffer.from(encoded).toString('hex'), vector.encodedHex, vector.name)
    assert.deepEqual(decodeStackChanFrame(encoded), frame, vector.name)
  }
})

test('Dock canonical invalid vector is rejected for its CRC mismatch', () => {
  assert.equal(fixture.invalidFrames.length, 1)
  const vector = fixture.invalidFrames[0]
  assert.equal(vector.reason, 'crc_mismatch')
  assert.throws(() => decodeStackChanFrame(bytes(vector.encodedHex)), /CRC mismatch/)
  assert.deepEqual(new StackChanFrameParser().push(bytes(vector.encodedHex)), [])
})

test('wire parser handles local fragmentation and coalescing scenarios using canonical frames', () => {
  assert.equal(parserFixture.schema, 'stackchan.firmware.usb-cdc.parser-scenarios.v1')
  const fragmented = requiredVector(parserFixture.parserScenarios.fragmentFrame)
  const fragmentedBytes = bytes(fragmented.encodedHex)
  const parser = new StackChanFrameParser()
  assert.deepEqual(parser.push(fragmentedBytes.slice(0, 5)), [])
  assert.deepEqual(parser.push(fragmentedBytes.slice(5, 17)), [])
  assert.deepEqual(parser.push(fragmentedBytes.slice(17)), [asFrame(fragmented)])

  const coalesced = parserFixture.parserScenarios.coalescedFrames.map(requiredVector)
  const joined = Uint8Array.from(coalesced.flatMap((vector) => [...bytes(vector.encodedHex)]))
  assert.deepEqual(new StackChanFrameParser().push(joined), coalesced.map(asFrame))
})

test('wire parser recovers from the canonical CRC-corrupt frame', () => {
  const corrupt = bytes(requiredInvalidVector(parserFixture.parserScenarios.crcCorruptFrame).encodedHex)
  const recovery = requiredVector(parserFixture.parserScenarios.recoveryFrame)
  const recoveryBytes = bytes(recovery.encodedHex)
  const joined = new Uint8Array(2 + corrupt.byteLength + recoveryBytes.byteLength)
  joined.set([0xff, 0x00])
  joined.set(corrupt, 2)
  joined.set(recoveryBytes, 2 + corrupt.byteLength)

  assert.deepEqual(new StackChanFrameParser().push(joined), [asFrame(recovery)])
})

test('EVENT decoder rejects the fixture sequence mismatch and clears the partial message', () => {
  const decoder = new StackChanEventDecoder()
  const [start, mismatch] = parserFixture.eventSequenceMismatch.frames.map(
    (frame): StackChanFrame => ({
      type: StackChanFrameType.EVENT,
      flags: frame.flags,
      streamId: parserFixture.eventSequenceMismatch.streamId,
      sequence: frame.sequence,
      payload: bytes(frame.payloadHex),
    }),
  )
  assert.equal(decoder.push(start), undefined)
  assert.throws(() => decoder.push(mismatch), new RegExp(parserFixture.eventSequenceMismatch.expectedError))
  assert.throws(() => decoder.push(mismatch), /no start chunk/)
})

function asFrame(vector: WireVector): StackChanFrame {
  return {
    type: vector.frame.type as StackChanFrameTypeValue,
    flags: vector.frame.flags,
    streamId: vector.frame.streamId,
    sequence: vector.frame.sequence,
    sampleRate: vector.frame.sampleRate,
    payload: bytes(vector.frame.payloadHex),
  }
}

function requiredVector(name: string): WireVector {
  const vector = frameByName.get(name)
  assert.ok(vector, `missing wire vector: ${name}`)
  return vector
}

function requiredInvalidVector(name: string): WireFixture['invalidFrames'][number] {
  const vector = invalidFrameByName.get(name)
  assert.ok(vector, `missing invalid wire vector: ${name}`)
  return vector
}

function bytes(hex: string): Uint8Array {
  return Uint8Array.from(Buffer.from(hex, 'hex'))
}
