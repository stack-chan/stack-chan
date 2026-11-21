import assert from 'node:assert/strict'
import test from 'node:test'
import { audioNoteMaxPcmBytes, createAudioNoteBody, wavHeader } from '../audio-note.js'

const options = { nodeId: 'homelink-fixture', sessionId: 'fixture-chat' }

test('WAV encodes bounded mono PCM16 at 16 kHz with known length', () => {
  const header = wavHeader(32000)
  const view = new DataView(header.buffer)
  assert.equal(Buffer.from(header.subarray(0, 4)).toString(), 'RIFF')
  assert.equal(view.getUint32(4, true), 32036)
  assert.equal(view.getUint16(20, true), 1)
  assert.equal(view.getUint16(22, true), 1)
  assert.equal(view.getUint32(24, true), 16000)
  assert.equal(view.getUint32(28, true), 32000)
  assert.equal(view.getUint16(34, true), 16)
  assert.equal(view.getUint32(40, true), 32000)
})

test('note matches official voice-note item shape and exact PCM across base64 boundaries', () => {
  for (const length of [2, 4, 6, 100, 3070, 3072, 3074, 32000, audioNoteMaxPcmBytes]) {
    const backing = Uint8Array.from({ length: length + 4 }, (_, i) => i % 251)
    const pcm = backing.subarray(2, length + 2)
    const body = createAudioNoteBody(pcm, options)
    const chunks = [...body]
    assert.ok(chunks.every((part) => part.length <= 4096))
    const serialized = chunks.join('')
    assert.equal(serialized.length, body.byteLength)
    const request = JSON.parse(serialized)
    assert.equal(request.output_modality, 'voice')
    assert.equal(request.device, 'mcu-wearable')
    assert.equal(request.device_id, options.nodeId)
    assert.equal(request.session_id, options.sessionId)
    assert.equal(request.items.length, 1)
    assert.equal(request.items[0].type, 'file')
    assert.equal(request.items[0].mime_type, 'audio/wav')
    const wav = Buffer.from(request.items[0].data_base64, 'base64')
    assert.deepEqual(wav.subarray(0, 44), Buffer.from(wavHeader(length)))
    assert.deepEqual(wav.subarray(44), Buffer.from(pcm))
  }
})

test('small base64 chunks preserve final padding', () => {
  const pcm = new Uint8Array([1, 2, 3, 4])
  const body = createAudioNoteBody(pcm, { ...options, chunkChars: 4, outputModality: 'text' })
  const request = JSON.parse([...body].join(''))
  assert.equal(request.output_modality, 'text')
  assert.deepEqual(Buffer.from(request.items[0].data_base64, 'base64').subarray(44), Buffer.from(pcm))
})

test('invalid PCM, metadata and oversized note fail before transmission', () => {
  for (const length of [0, 1, 3, audioNoteMaxPcmBytes + 2]) {
    assert.throws(() => createAudioNoteBody(new Uint8Array(length), options))
  }
  for (const value of ['', '../chat', 'line\nbreak', 'x'.repeat(129)]) {
    assert.throws(() => createAudioNoteBody(new Uint8Array(2), { ...options, nodeId: value }))
    assert.throws(() => createAudioNoteBody(new Uint8Array(2), { ...options, sessionId: value }))
  }
  for (const chunkChars of [0, 3, 5, 4097, Infinity]) {
    assert.throws(() => createAudioNoteBody(new Uint8Array(2), { ...options, chunkChars }))
  }
  assert.throws(() => createAudioNoteBody(new ArrayBuffer(2), options))
  assert.throws(() => createAudioNoteBody(new Uint8Array(2), { ...options, outputModality: 'video' }))
})

test('injected encoder exactly matches fallback chunks including WAV crossing and final padding', () => {
  for (const chunkChars of [4, 8, 60, 4096]) {
    for (const length of [2, 4, 6, 100, 3026, 3028, 3030, 3070, 3072, 3074, 32000]) {
      const backing = Uint8Array.from({ length: length + 8 }, (_, i) => i % 251)
      const pcm = backing.subarray(4, length + 4)
      const opts = { ...options, chunkChars }
      const calls = []
      const body = createAudioNoteBody(pcm, opts, {
        encodeBase64(bytes) {
          calls.push(bytes.length)
          assert.ok(bytes.length <= 3072)
          return Buffer.from(bytes).toString('base64')
        },
      })
      const expected = [...createAudioNoteBody(pcm, opts)]
      assert.deepEqual([...body], expected)
      assert.ok(calls.slice(0, -1).every(size => size % 3 === 0))
      assert.equal(expected.join('').length, body.byteLength)
      assert.deepEqual([...body], expected)
    }
  }
})

test('native-shaped encoder remains bounded at maximum note length and handles abandoned iterators', () => {
  const pcm = new Uint8Array(audioNoteMaxPcmBytes).fill(231)
  const buffers = new Set()
  const body = createAudioNoteBody(pcm, options, {
    encodeBase64(bytes) {
      assert.ok(bytes.length <= 3072)
      buffers.add(bytes.buffer)
      return Buffer.from(bytes).toString('base64')
    },
  })
  const first = body[Symbol.iterator]()
  first.next()
  first.next()
  first.return()
  assert.deepEqual([...body], [...createAudioNoteBody(pcm, options)])
  assert.equal(buffers.size, 2)
  assert.ok([...buffers].every(buffer => buffer.byteLength === 3072))
})

test('bad encoder dependencies fail rather than produce a malformed body', () => {
  assert.throws(() => createAudioNoteBody(new Uint8Array(2), options, { encodeBase64: 42 }))
  for (const encodeBase64 of [() => '', () => undefined, () => { throw new Error('encoder failed') }]) {
    assert.throws(() => [...createAudioNoteBody(new Uint8Array(2), options, { encodeBase64 })])
  }
})
