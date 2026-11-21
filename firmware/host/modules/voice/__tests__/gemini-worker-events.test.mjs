import assert from 'node:assert/strict'
import test from 'node:test'
import { createSpeechEvents } from '../gemini-worker-events.js'

String.fromArrayBuffer = (bytes, offset = 0, length = bytes.byteLength - offset) =>
  new TextDecoder().decode(new Uint8Array(bytes, offset, length))
Uint8Array.fromBase64 ??= (value, options) => {
  assert.deepEqual(options, { lastChunkHandling: 'strict' })
  const bytes = Buffer.from(value, 'base64')
  if (bytes.toString('base64') !== value) throw new SyntaxError('invalid base64')
  return new Uint8Array(bytes)
}
const encode = (text) => new TextEncoder().encode(text)
const event = (value) => `data: ${JSON.stringify(value)}\n\n`
const audio = (bytes) => ({
  event_type: 'step.delta',
  delta: { type: 'audio', mime_type: 'audio/l16;rate=24000', data: Buffer.from(bytes).toString('base64') },
})
const done = { event_type: 'interaction.completed', interaction: { status: 'completed' } }
function fixture(options = {}) {
  const blocks = []
  return { blocks, parser: createSpeechEvents({ onPcm: (bytes) => blocks.push(bytes.slice()), ...options }) }
}
test('fragmented SSE preserves every PCM byte and limits consumer blocks', async () => {
  const expected = Uint8Array.from({ length: 12000 }, (_, i) => i % 256)
  const payload = encode(event(audio(expected.subarray(0, 1))) + event(audio(expected.subarray(1))) + event(done))
  for (const chunkSize of [1, 31, 1024, payload.length]) {
    const { parser, blocks } = fixture()
    for (let offset = 0; offset < payload.length; offset += chunkSize)
      await parser.feed(payload.subarray(offset, offset + chunkSize))
    await parser.finish()
    assert.equal(parser.isComplete(), true)
    assert.deepEqual(Buffer.concat(blocks), Buffer.from(expected))
    assert.ok(blocks.every((bytes) => bytes.length <= 2048 && bytes.length % 2 === 0))
    assert.equal(parser.metrics.pcmBytes, expected.length)
  }
})
test('backpressure prevents a subsequent offer until consumer settles', async () => {
  let release,
    calls = 0
  const blocked = new Promise((resolve) => {
    release = resolve
  })
  const { parser } = fixture({
    onPcm: async () => {
      calls++
      await blocked
    },
  })
  const feeding = parser.feed(encode(event(audio(new Uint8Array(8192))) + event(done)))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(calls, 1)
  release()
  await feeding
  await parser.finish()
  assert.equal(calls, 4)
})
test('CRLF and multiline data support UTF-8 split across reads', async () => {
  const { parser, blocks } = fixture()
  const raw =
    ': 日本語\r\n\r\ndata: {"event_type":"step.delta",\r\ndata: "delta":{"type":"audio","data":"AQACAA=="}}\r\n\r\n' +
    event(done)
  for (const byte of encode(raw)) await parser.feed(Uint8Array.of(byte))
  await parser.finish()
  assert.deepEqual(Buffer.concat(blocks), Buffer.from([1, 0, 2, 0]))
})
for (const [name, payload, code] of [
  ['empty', '', 'provider_failed'],
  ['missing terminal', event(audio([1, 0])), 'provider_failed'],
  ['no audio', event(done), 'provider_failed'],
  ['odd final frame', event(audio([1])) + event(done), 'provider_failed'],
  [
    'failed terminal',
    event(audio([1, 0])) + event({ ...done, interaction: { status: 'requires_action' } }),
    'provider_failed',
  ],
  ['server error', event({ event_type: 'error', error: { detail: 'secret' } }), 'provider_failed'],
  ['malformed JSON', 'data: secret!\n\n', 'provider_failed'],
  [
    'bad mime',
    event({ event_type: 'step.delta', delta: { type: 'audio', data: 'AQAA', mime_type: 'audio/wav' } }),
    'unsupported_capability',
  ],
  ['post-terminal audio', event(audio([1, 0])) + event(done) + event(audio([2, 0])), 'provider_failed'],
]) {
  test(`rejects ${name} without exception detail leakage`, async () => {
    const { parser } = fixture()
    await assert.rejects(
      async () => {
        await parser.feed(encode(payload))
        await parser.finish()
      },
      { code, message: code },
    )
    assert.equal(parser.isComplete(), false)
  })
}
for (const data of [
  'A?==',
  'AB==',
  'AAB=',
  'AA A',
  'AA=\n',
  'AA=A',
  'A===',
  'AQID    ',
  '   AQID ',
  'AQ==    ',
  'AA-_',
  'AAAA====',
]) {
  test(`rejects noncanonical base64 ${JSON.stringify(data)}`, async () => {
    const { parser, blocks } = fixture()
    await assert.rejects(parser.feed(encode(event({ event_type: 'step.delta', delta: { type: 'audio', data } }))), {
      code: 'provider_failed',
    })
    assert.equal(blocks.length, 0)
  })
}
test('enforces event byte budget before decoding', async () => {
  const { parser, blocks } = fixture({ maxEventBytes: 256 })
  await assert.rejects(parser.feed(encode(`data: ${'x'.repeat(251)}`)), { code: 'resource_exhausted' })
  assert.equal(blocks.length, 0)
})
test('consumer error aborts later PCM delivery', async () => {
  let count = 0
  const { parser } = fixture({
    onPcm: () => {
      count++
      throw Object.assign(new Error('cancelled'), { code: 'cancelled' })
    },
  })
  await assert.rejects(parser.feed(encode(event(audio(new Uint8Array(8192))))), { code: 'cancelled' })
  assert.equal(count, 1)
  await assert.rejects(parser.finish())
})

test('requires native Base64 and rejects inconsistent native decode lengths', async () => {
  const original = Uint8Array.fromBase64
  try {
    Uint8Array.fromBase64 = undefined
    await assert.rejects(fixture().parser.feed(encode(event(audio([1, 0])))), { code: 'unsupported_capability' })
    Uint8Array.fromBase64 = () => new Uint8Array(0)
    await assert.rejects(fixture().parser.feed(encode(event(audio([1, 0])))), { code: 'provider_failed' })
  } finally {
    Uint8Array.fromBase64 = original
  }
})
test('pairs single-byte deltas and finishes idempotently', async () => {
  const { parser, blocks } = fixture()
  await parser.feed(encode(event(audio([1])) + event(audio([2])) + event(done)))
  await parser.finish()
  await parser.finish()
  assert.deepEqual(Buffer.concat(blocks), Buffer.from([1, 2]))
  await assert.rejects(parser.feed(encode(event(audio([3, 4])))))
})

test('every split boundary preserves CRLF and skips preceding comments', async () => {
  const payload = encode(`: first\n\n${event(audio([1, 0, 2, 0]))}: next\n\n${event(done)}`.replaceAll('\n', '\r\n'))
  for (let split = 0; split <= payload.length; split++) {
    const { parser, blocks } = fixture()
    await parser.feed(payload.subarray(0, split))
    await parser.feed(payload.subarray(split))
    await parser.finish()
    assert.deepEqual(Buffer.concat(blocks), Buffer.from([1, 0, 2, 0]))
  }
})
test('exact event limit allows framing and rejects one additional byte across fragments', async () => {
  const suffix = event(audio([1, 0]))
  const exact = `:${'x'.repeat(256 - encode(suffix).length - 2)}\n${suffix}`
  assert.equal(encode(exact).length, 256)
  for (const split of [0, 1, 255, 256]) {
    const { parser } = fixture({ maxEventBytes: 256 })
    await parser.feed(encode(exact).subarray(0, split))
    await parser.feed(encode(exact).subarray(split))
    await parser.feed(encode(event(done)))
    await parser.finish()
  }
  const { parser } = fixture({ maxEventBytes: 256 })
  await parser.feed(encode(exact.slice(0, -1)))
  await assert.rejects(parser.feed(encode(' \n')), { code: 'resource_exhausted' })
})
test('maxEventChars measures JSON data rather than SSE framing or comments', async () => {
  const value = audio(new Uint8Array(5760))
  const { parser } = fixture()
  await parser.feed(encode(`: ${'x'.repeat(10000)}\n\n${event(value).replaceAll('\n', '\r\n')}${event(done)}`))
  await parser.finish()
  assert.equal(parser.metrics.maxEventChars, JSON.stringify(value).length)
})

test('reassembles events with many data lines and ignores comment lines', async () => {
  const { parser, blocks } = fixture()
  const lines = [
    'data: {',
    ...Array.from({ length: 256 }, (_, i) => `data: "field${i}":null,`),
    'data:',
    ': ignored',
    'data: "event_type":"step.delta","delta":{"type":"audio","data":"AQI="}}',
  ]
  await parser.feed(encode(`${lines.join('\r\n')}\r\n\r\n${event(done)}`))
  await parser.finish()
  assert.deepEqual(Buffer.concat(blocks), Buffer.from([1, 2]))
})

for (const mime of ['audio/L16;rate=24000', 'audio/l16', 'audio/L16;channels=1', 'audio/L16;rate=24000;channels=1']) {
  test(`accepts the established 24 kHz mono L16 declaration: ${mime}`, async () => {
    const { parser, blocks } = fixture()
    const value = audio([1, 2, 3, 4])
    value.delta.mime_type = mime
    await parser.feed(encode(event(value) + event(done)))
    await parser.finish()
    assert.deepEqual(Buffer.concat(blocks), Buffer.from([1, 2, 3, 4]))
  })
}
for (const mime of ['audio/L16;rate=16000', 'audio/L16;rate=24000;channels=2', 'audio/mpeg', null]) {
  test(`does not play an incompatible format: ${mime}`, async () => {
    const { parser, blocks } = fixture()
    const value = audio([1, 2, 3, 4])
    value.delta.mime_type = mime
    await assert.rejects(parser.feed(encode(event(value))), { code: 'unsupported_capability' })
    assert.equal(blocks.length, 0)
  })
}

test('scans only the incoming byte view and reports complete framing work', async () => {
  const content = encode(event(audio([4, 0, 6, 0])) + event(done))
  const padded = new Uint8Array(content.length + 8).fill(10)
  padded.set(content, 3)
  const view = padded.subarray(3, 3 + content.length)
  let calls = 0,
    tick = 0
  const { parser, blocks } = fixture({
    now: () => tick++,
    findLF(bytes, offset) {
      assert.equal(bytes, view)
      assert.ok(offset >= 0 && offset < bytes.length)
      calls++
      return bytes.indexOf(10, offset)
    },
  })
  await parser.feed(view)
  await parser.finish()
  const m = parser.metrics.framing
  assert.deepEqual(Buffer.concat(blocks), Buffer.from([4, 0, 6, 0]))
  assert.equal(m.calls, 1)
  assert.equal(m.scans, calls)
  assert.equal(m.bytes, content.length)
  assert.equal(m.frames, 2)
  assert.ok(m.scanMs > 0 && m.copyMs > 0 && m.totalMs >= m.scanMs + m.copyMs)
})

test('synchronous PCM acceptance does not schedule a microtask per block', async () => {
  const { parser, blocks } = fixture()
  const feeding = parser.feed(encode(event(audio(new Uint8Array(8192))) + event(done)))
  assert.equal(blocks.length, 4)
  await feeding
  await parser.finish()
  assert.equal(parser.metrics.pcmBytes, 8192)
})

test('thenable PCM acceptance still blocks the next decoded block', async () => {
  let calls = 0,
    release
  const { parser } = fixture({
    onPcm() {
      calls++
      return calls === 1
        ? {
            // biome-ignore lint/suspicious/noThenProperty: exercises the consumer thenable contract
            then(resolve) {
              release = resolve
            },
          }
        : undefined
    },
  })
  const feeding = parser.feed(encode(event(audio(new Uint8Array(4096))) + event(done)))
  await Promise.resolve()
  assert.equal(calls, 1)
  release()
  await feeding
  await parser.finish()
  assert.equal(calls, 2)
})

test('asynchronous PCM rejection stops delivery without counting unaccepted samples', async () => {
  let calls = 0
  const { parser } = fixture({
    onPcm() {
      calls++
      return Promise.reject(Object.assign(Error('cancelled'), { code: 'cancelled' }))
    },
  })
  await assert.rejects(parser.feed(encode(event(audio(new Uint8Array(4096))) + event(done))), { code: 'cancelled' })
  assert.equal(calls, 1)
  assert.equal(parser.metrics.pcmBytes, 0)
  assert.equal(parser.isComplete(), false)
})

const trailer = 'event: done\ndata: [DONE]\n\n'
for (const chunk of [1, 97, 16384]) {
  test(`accepts official done trailer with read size ${chunk}`, async () => {
    const { parser, blocks } = fixture()
    const data = encode(event(audio([1, 0])) + event(done) + trailer)
    for (let i = 0; i < data.length; i += chunk) await parser.feed(data.subarray(i, i + chunk))
    await parser.finish()
    assert.deepEqual(Buffer.concat(blocks), Buffer.from([1, 0]))
    assert.equal(parser.isComplete(), true)
  })
}
test('trailer cannot replace completion or authorize more audio', async () => {
  for (const text of [event(audio([1, 0])) + trailer, event(audio([1, 0])) + event(done) + trailer + event(audio([2, 0]))]) {
    const { parser } = fixture()
    await assert.rejects(parser.feed(encode(text)), { code: 'provider_failed' })
  }
})

for (const [mime, accepted] of [['audio/L16; rate=16000; channels=1', true], ['audio/l16;rate=24000', false], ['audio/l16', false], [undefined, false], ['audio/l16;rate=16000;channels=2', false]]) {
  test('experimental rate requires explicit matching mono MIME: ' + mime, async () => {
    const { parser, blocks } = fixture({ sampleRate: 16000 })
    const value = audio(Uint8Array.of(1, 2))
    value.delta.mime_type = mime
    if (!accepted) {
      await assert.rejects(parser.feed(encode(event(value))), { code: 'unsupported_capability' })
      assert.equal(blocks.length, 0)
      return
    }
    await parser.feed(encode(event(value) + event(done)))
    await parser.finish()
    assert.deepEqual(blocks, [Uint8Array.of(1, 2)])
  })
}
