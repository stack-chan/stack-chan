import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks, stripTypeScriptTypes } from 'node:module'
import test, { beforeEach } from 'node:test'
import './base64-fixture.mjs'

ArrayBuffer.fromString = (value) => new TextEncoder().encode(value).buffer
String.fromArrayBuffer = (value) => new TextDecoder().decode(value)
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'timer') return next(new URL('../../testing/fakes/timer.ts', import.meta.url).href, context)
    if (specifier.startsWith('stackchan/voice/'))
      return next(new URL(`../${specifier.slice(16)}.ts`, import.meta.url).href, context)
    if (specifier.startsWith('stackchan-ai-'))
      return next(new URL(`../../ai/ai-${specifier.slice(13)}.ts`, import.meta.url).href, context)
    return next(specifier, context)
  },
  load(url, context, next) {
    if (url.endsWith('/ai-wire.ts'))
      return {
        shortCircuit: true,
        format: 'module',
        source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8'), { mode: 'strip' }),
      }
    return next(url, context)
  },
})
const { GeminiTranscribeSTT, GeminiSpeechTTS } = await import('../gemini-speech.ts')
const { mono, writeSink, subscribePcmSource } = await import('../media.ts')
const { createVoiceScope, deferred } = await import('../scope.ts')
const { default: Timer } = await import('../../testing/fakes/timer.ts')
const bytes = (text) => new TextEncoder().encode(text)
const sse = (event) => bytes(`data: ${JSON.stringify(event)}\n\n`)
const complete = { event_type: 'interaction.completed', interaction: { status: 'completed' } }
const audio = (data) => ({
  event_type: 'step.delta',
  delta: { type: 'audio', mime_type: 'audio/l16;rate=24000', data: Buffer.from(data).toString('base64') },
})
const transcript = (text) => ({
  status: 'completed',
  steps: [{ type: 'model_output', content: [{ type: 'text', text }] }],
})
const tick = () => new Promise((resolve) => setImmediate(resolve))
function bodyJSON(body) {
  const chunks = [...body.read()]
  assert.equal(
    chunks.reduce((n, part) => n + part.length, 0),
    body.length,
  )
  return { value: JSON.parse(Buffer.concat(chunks).toString()), chunks }
}
beforeEach(() => Timer.reset())

test('STT emits lazy WAV base64 with verbatim Japanese config and parses only model text', async () => {
  let sent
  const events = []
  const stt = await GeminiTranscribeSTT.create({
    request: async (body, consume) => {
      sent = bodyJSON(body)
      const reply = bytes(JSON.stringify(transcript('こんにちは')))
      for (const byte of reply) await consume(Uint8Array.of(byte))
    },
  }).open({ ...createVoiceScope(), format: mono(16000), utteranceId: 'u', onTranscript: (event) => events.push(event) })
  const pcm = Uint8Array.from({ length: 480000 }, (_, i) => i & 255)
  await writeSink(stt.input, pcm)
  await stt.finish()
  assert.equal(sent.value.model, 'gemini-3.5-transcribe')
  assert.equal(sent.value.store, false)
  assert.equal(sent.value.stream, false)
  assert.deepEqual(sent.value.generation_config.transcription_config, {
    language_codes: ['ja-JP'],
    mode: { type: 'verbatim' },
  })
  assert.equal(sent.value.input[0].mime_type, 'audio/wav')
  assert.ok(sent.chunks.every((chunk) => chunk.length <= 4096))
  const wave = Buffer.from(sent.value.input[0].data, 'base64')
  assert.equal(wave.subarray(0, 4).toString(), 'RIFF')
  assert.equal(wave.readUInt32LE(24), 16000)
  assert.equal(wave.readUInt32LE(40), pcm.length)
  assert.deepEqual(wave.subarray(44), Buffer.from(pcm))
  assert.deepEqual(events, [{ utteranceId: 'u', text: 'こんにちは', final: true }])
  await stt.close()
})

test('STT empty capture skips request; buffer, format and response limits fail closed', async () => {
  let requests = 0
  const provider = GeminiTranscribeSTT.create({
    maxAudioBytes: 4,
    request: async (_, consume) => {
      requests++
      await consume(new Uint8Array(32769))
    },
  })
  await assert.rejects(provider.open({ ...createVoiceScope(), format: mono(24000) }), {
    code: 'unsupported_capability',
  })
  const events = []
  const empty = await provider.open({
    ...createVoiceScope(),
    format: mono(16000),
    utteranceId: 'empty',
    onTranscript: (e) => events.push(e),
  })
  await empty.finish()
  await empty.close()
  assert.equal(requests, 0)
  assert.equal(events[0].text, '')
  const full = await provider.open({
    ...createVoiceScope(),
    format: mono(16000),
    onTranscript() {
      assert.fail('must not transcribe')
    },
  })
  await writeSink(full.input, new Uint8Array(4))
  await assert.rejects(writeSink(full.input, new Uint8Array(2)), { code: 'input_overrun' })
  await assert.rejects(full.finish(), { code: 'resource_exhausted' })
  await full.close()
})

for (const reply of [
  '',
  '{}',
  JSON.stringify({ status: 'in_progress' }),
  JSON.stringify({ status: 'completed', steps: [] }),
]) {
  test(`STT rejects malformed or incomplete response ${reply}`, async () => {
    const stt = await GeminiTranscribeSTT.create({ request: async (_, consume) => consume(bytes(reply)) }).open({
      ...createVoiceScope(),
      format: mono(16000),
      onTranscript() {
        assert.fail()
      },
    })
    await writeSink(stt.input, new Uint8Array(2))
    await assert.rejects(stt.finish(), { code: 'provider_failed' })
    await stt.close()
  })
}

async function synthesis(request, options = {}) {
  const scope = createVoiceScope(),
    heard = [],
    ends = []
  const result = await GeminiSpeechTTS.create({ request, ...options }).open({
    ...scope,
    format: mono(24000),
    voice: 'Leda',
  })
  subscribePcmSource(result.output, {
    write(data) {
      heard.push(...data)
    },
    end(error) {
      ends.push(error)
    },
  })
  return { result, scope, heard, ends }
}

test('TTS sends separate style, voice, stream and no-store; flush remains reusable', async () => {
  const sent = []
  const f = await synthesis(
    async (body, consume, _, isComplete) => {
      sent.push(bodyJSON(body).value)
      assert.equal(isComplete(), false)
      const frame = sse(audio([1, 0, 2, 0]))
      for (const byte of frame) await consume(Uint8Array.of(byte))
      await consume(sse(complete))
      assert.equal(isComplete(), true)
    },
    { instructions: 'Cute, high and gentle.' },
  )
  await f.result.write('one')
  await f.result.flush()
  assert.equal(f.ends.length, 0)
  await f.result.write('two')
  await f.result.endInput()
  assert.deepEqual(f.heard, [1, 0, 2, 0, 1, 0, 2, 0])
  assert.deepEqual(
    sent.map((v) => v.input[0].content[0].text),
    ['one', 'two'],
  )
  for (const request of sent) {
    assert.equal(request.model, 'gemini-3.8-flash-tts')
    assert.equal(request.store, false)
    assert.equal(request.stream, true)
    assert.deepEqual(request.response_format, { type: 'audio' })
    assert.deepEqual(request.generation_config.speech_config, [{ voice: 'Leda' }])
    assert.deepEqual(request.input[0].content[0].annotations, [
      { type: 'speech_metadata', style: 'Cute, high and gentle.' },
    ])
  }
  await assert.rejects(f.result.write('late'), { code: 'cancelled' })
  await f.result.close()
})

test('TTS bounds PCM slices, preserves odd delta boundaries and awaits backpressure', async () => {
  const pending = deferred(),
    got = deferred(),
    received = []
  let progressed = false
  const f = await synthesis(async (_, consume) => {
    await consume(sse(audio([1])))
    await consume(sse(audio(Uint8Array.from({ length: 4095 }, (_, i) => i & 255))))
    progressed = true
    await consume(sse(complete))
  })
  subscribePcmSource(f.result.output, {
    async write(data) {
      received.push(data.slice())
      got.resolve()
      await pending.promise
    },
    end() {},
  })
  await f.result.write('text')
  const end = f.result.endInput()
  await got.promise
  assert.equal(progressed, false)
  pending.resolve()
  await end
  assert.ok(received.every((chunk) => chunk.length <= 4096 && chunk.length % 2 === 0))
  assert.equal(f.heard.length, 4096)
  assert.equal(f.heard[0], 1)
  await f.result.close()
})

for (const [name, events, code] of [
  ['missing terminal', [audio([1, 0])], 'provider_failed'],
  ['empty response', [], 'provider_failed'],
  ['no audio', [complete], 'provider_failed'],
  ['odd PCM', [audio([1]), complete], 'provider_failed'],
  [
    'invalid base64',
    [{ event_type: 'step.delta', delta: { type: 'audio', data: 'A?==' } }, complete],
    'provider_failed',
  ],
  [
    'bad padding bits',
    [{ event_type: 'step.delta', delta: { type: 'audio', data: 'AB==' } }, complete],
    'provider_failed',
  ],
  [
    'bad mime',
    [{ ...audio([1, 0]), delta: { ...audio([1, 0]).delta, mime_type: 'audio/wav' } }],
    'unsupported_capability',
  ],
  ['server error', [{ event_type: 'error', error: { code: 'failed' } }], 'provider_failed'],
  [
    'requires action',
    [audio([1, 0]), { event_type: 'interaction.completed', interaction: { status: 'requires_action' } }],
    'provider_failed',
  ],
]) {
  test(`TTS rejects ${name} and cannot reuse a failed synthesis`, async () => {
    const f = await synthesis(async (_, consume) => {
      for (const event of events) await consume(sse(event))
    })
    await f.result.write('hello')
    await assert.rejects(f.result.endInput(), { code })
    await assert.rejects(f.result.write('retry'))
    await f.result.close()
  })
}

test('TTS rejects an oversized SSE event before PCM decode', async () => {
  const f = await synthesis(async (_, consume) => {
    await consume(bytes('data: ' + 'x'.repeat(65536)))
  })
  await f.result.write('hello')
  await assert.rejects(f.result.endInput(), { code: 'resource_exhausted' })
  assert.deepEqual(f.heard, [])
  await f.result.close()
})

test('endInput waits for an in-flight flush and then synthesizes its queued tail', async () => {
  const first = deferred(),
    sent = []
  const f = await synthesis(async (body, consume) => {
    sent.push(bodyJSON(body).value.input[0].content[0].text)
    if (sent.length === 1) await first.promise
    await consume(sse(audio([1, 0])))
    await consume(sse(complete))
  })
  await f.result.write('first')
  const flushed = f.result.flush()
  await f.result.write('tail')
  await assert.rejects(f.result.flush(), { code: 'device_busy' })
  const ended = f.result.endInput()
  assert.equal(f.result.endInput(), ended)
  await tick()
  assert.deepEqual(sent, ['first'])
  first.resolve()
  await flushed
  await ended
  assert.deepEqual(sent, ['first', 'tail'])
  await f.result.close()
})

test('total safety deadline during consumer backpressure cannot deliver the remainder of an audio event', async () => {
  const pending = deferred(),
    got = deferred(),
    transportEnded = deferred()
  let writes = 0
  const f = await synthesis(
    async (_, consume) => {
      try {
        await consume(sse(audio(new Uint8Array(8192))))
      } finally {
        transportEnded.resolve()
      }
    },
    { timeoutMs: 10 },
  )
  subscribePcmSource(f.result.output, {
    async write() {
      writes++
      got.resolve()
      await pending.promise
    },
    end() {},
  })
  await f.result.write('hello')
  const done = assert.rejects(f.result.endInput(), { code: 'deadline_exceeded' })
  await got.promise
  Timer.advance(180000)
  await done
  pending.resolve()
  await transportEnded.promise
  assert.equal(writes, 1)
  assert.equal(f.heard.length, 4096)
  await f.result.close()
})

test('empty TTS closes without HTTP and missing request is rejected', async () => {
  assert.throws(() => GeminiTranscribeSTT.create({}), TypeError)
  assert.throws(() => GeminiSpeechTTS.create({}), TypeError)
  const f = await synthesis(async () => assert.fail('empty speech must not issue HTTP'))
  await f.result.flush()
  await f.result.endInput()
  await f.result.close()
  assert.deepEqual(f.heard, [])
})

for (const mode of ['close', 'deadline']) {
  test(`TTS ${mode} settles uncooperative transport and rejects its late data`, async () => {
    let late
    const f = await synthesis(
      async (_, consume) => {
        late = consume
        await new Promise(() => {})
      },
      { timeoutMs: 10 },
    )
    await f.result.write('hello')
    const done = assert.rejects(f.result.endInput(), { code: mode === 'close' ? 'cancelled' : 'deadline_exceeded' })
    await tick()
    if (mode === 'close') await f.result.close()
    else Timer.advance(10)
    await done
    await assert.rejects(late(sse(audio([1, 0]))))
    assert.deepEqual(f.heard, [])
    await f.result.close()
  })
  test(`STT ${mode} suppresses late transcript`, async () => {
    let late
    const stt = await GeminiTranscribeSTT.create({
      timeoutMs: 10,
      request: async (_, consume) => {
        late = consume
        await new Promise(() => {})
      },
    }).open({
      ...createVoiceScope(),
      format: mono(16000),
      onTranscript() {
        assert.fail()
      },
    })
    await writeSink(stt.input, new Uint8Array(2))
    const done = assert.rejects(stt.finish(), { code: mode === 'close' ? 'cancelled' : 'deadline_exceeded' })
    await tick()
    if (mode === 'close') await stt.close()
    else Timer.advance(10)
    await done
    await assert.rejects(late(bytes(JSON.stringify(transcript('late')))))
    await stt.close()
  })
}

test('TTS metrics contain only counters and a throwing observer cannot fail speech', async () => {
  const metrics = []
  const f = await synthesis(
    async (_, consume) => {
      await consume(sse(audio([1, 0, 2, 0])))
      await consume(sse(complete))
    },
    {
      onMetrics(value) {
        metrics.push(value)
        throw new Error('observer')
      },
    },
  )
  await f.result.write('private phrase')
  await f.result.endInput()
  assert.equal(metrics.length, 1)
  assert.deepEqual(Object.keys(metrics[0]), ['maxEventChars', 'pcmBytes'])
  assert.equal(metrics[0].pcmBytes, 4)
  assert.equal(metrics[0].maxEventChars, JSON.stringify(audio([1, 0, 2, 0])).length)
  await f.result.close()
})

async function withNativeDecoder(decode, run) {
  const descriptor = Object.getOwnPropertyDescriptor(Uint8Array, 'fromBase64')
  Object.defineProperty(Uint8Array, 'fromBase64', { configurable: true, writable: true, value: decode })
  try {
    await run()
  } finally {
    if (descriptor) Object.defineProperty(Uint8Array, 'fromBase64', descriptor)
    else delete Uint8Array.fromBase64
  }
}

test('native decoder uses strict mode and preserves odd deltas, PCM order and bounded offers', async () => {
  const calls = [],
    offers = []
  const expected = Uint8Array.from({ length: 4098 }, (_, i) => i & 255)
  await withNativeDecoder(
    (data, options) => {
      calls.push(options)
      return new Uint8Array(Buffer.from(data, 'base64'))
    },
    async () => {
      const f = await synthesis(async (_, consume) => {
        await consume(sse(audio(expected.subarray(0, 1))))
        await consume(sse(audio(expected.subarray(1))))
        await consume(sse(complete))
      })
      subscribePcmSource(f.result.output, {
        write(data) {
          offers.push(data.length)
        },
        end() {},
      })
      try {
        await f.result.write('native fixture')
        await f.result.endInput()
        assert.deepEqual(f.heard, [...expected])
        assert.deepEqual(calls, [{ lastChunkHandling: 'strict' }, { lastChunkHandling: 'strict' }])
        assert.ok(offers.every((size) => size > 0 && size <= 4096 && size % 2 === 0))
      } finally {
        await f.result.close()
      }
    },
  )
})

for (const data of ['AA=\n', 'AAAAAAA\n', 'AA A', 'AA=A', 'A===', 'AB==', 'AAB=']) {
  test(`invalid base64 is rejected without emitting PCM: ${JSON.stringify(data)}`, async () => {
    await withNativeDecoder(
      (value) => {
        const decoded = Buffer.from(value, 'base64')
        if (decoded.toString('base64') !== value) throw new SyntaxError('invalid base64')
        return new Uint8Array(decoded)
      },
      async () => {
        const f = await synthesis(async (_, consume) => {
          await consume(sse({ event_type: 'step.delta', delta: { type: 'audio', data } }))
          await consume(sse(complete))
        })
        try {
          await f.result.write('invalid fixture')
          await assert.rejects(f.result.endInput(), { code: 'provider_failed' })
          assert.deepEqual(f.heard, [])
        } finally {
          await f.result.close()
        }
      },
    )
  })
}

for (const mode of ['syntax', 'length', 'allocation']) {
  test(`native decoder ${mode} failure does not fall back to permissive decoding`, async () => {
    const allocationFailure = new RangeError('synthetic allocation failure')
    await withNativeDecoder(
      () => {
        if (mode === 'syntax') throw new SyntaxError('synthetic invalid input')
        if (mode === 'allocation') throw allocationFailure
        return new Uint8Array(0)
      },
      async () => {
        const f = await synthesis(async (_, consume) => {
          await consume(sse(audio([1, 0])))
          await consume(sse(complete))
        })
        try {
          await f.result.write('failure fixture')
          await assert.rejects(
            f.result.endInput(),
            mode === 'allocation' ? (error) => error === allocationFailure : { code: 'provider_failed' },
          )
          assert.deepEqual(f.heard, [])
        } finally {
          await f.result.close()
        }
      },
    )
  })
}

test('native PCM decode respects backpressure and cancellation suppresses its remaining bytes', async () => {
  await withNativeDecoder(
    (data) => new Uint8Array(Buffer.from(data, 'base64')),
    async () => {
      const pending = deferred(),
        entered = deferred(),
        transportEnded = deferred()
      const f = await synthesis(async (_, consume) => {
        try {
          await consume(sse(audio(new Uint8Array(8192))))
        } finally {
          transportEnded.resolve()
        }
      })
      let calls = 0
      subscribePcmSource(f.result.output, {
        async write() {
          calls++
          entered.resolve()
          await pending.promise
        },
        end() {},
      })
      try {
        await f.result.write('cancel fixture')
        const outcome = assert.rejects(f.result.endInput(), { code: 'cancelled' })
        await entered.promise
        await tick()
        assert.equal(calls, 1)
        f.scope.abort()
        await outcome
        pending.resolve()
        await transportEnded.promise
        assert.equal(calls, 1)
        assert.equal(f.heard.length, 4096)
      } finally {
        pending.resolve()
        await f.result.close()
      }
    },
  )
})

test('SSE handles CRLF and multiple data lines without changing decoded PCM', async () => {
  const f = await synthesis(async (_, consume) => {
    const event = JSON.stringify(audio([1, 0, 2, 0])).replace(',"delta"', ',\r\ndata: "delta"')
    const wire = bytes(`event: step.delta\r\ndata: ${event}\r\n\r\n`)
    for (const byte of wire) await consume(Uint8Array.of(byte))
    await consume(sse(complete))
  })
  await f.result.write('fixture')
  await f.result.endInput()
  assert.deepEqual(f.heard, [1, 0, 2, 0])
  await f.result.close()
})

test('TTS failure diagnostics expose only fixed categories, not exception contents', async () => {
  for (const [message, expected] of [
    ['Responses connection closed early', 9],
    ['Responses connection failed: private-token', 11],
    ['Responses HTTP 503', 12],
    ['private utterance and key', 0],
  ]) {
    const reasons = []
    const tts = await GeminiSpeechTTS.create({
      request: async () => {
        throw new Error(message)
      },
      onFailure: (reason) => reasons.push(reason),
    }).open({ ...createVoiceScope(), format: mono(24000) })
    await tts.write('hello')
    await assert.rejects(tts.flush())
    assert.deepEqual(reasons, [expected])
    await tts.close()
  }
})

test('TTS rejects a runtime without native Base64 decoding without emitting PCM', async () => {
  await withNativeDecoder(undefined, async () => {
    const f = await synthesis(async (_, consume) => {
      await consume(sse(audio([1, 0])))
      await consume(sse(complete))
    })
    try {
      await f.result.write('unsupported runtime')
      await assert.rejects(f.result.endInput(), { code: 'unsupported_capability' })
      assert.deepEqual(f.heard, [])
    } finally {
      await f.result.close()
    }
  })
})

test('short synthetic STT release traverses a bounded number of loopback writes', async (t) => {
  const { createServer, request } = await import('node:http')
  const { once } = await import('node:events')
  const pcm = Uint8Array.from({ length: 48000 }, (_, i) => (17 * i + 3) & 255)
  const reply = JSON.stringify(transcript('おはようございます'))
  let times, posted, transcriptText
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const part of req) chunks.push(part)
    times.peerReceived = performance.now()
    posted = JSON.parse(Buffer.concat(chunks).toString())
    res.end(reply)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => {
    server.closeAllConnections()
    server.close()
  })
  const observations = []
  for (let i = 0; i < (process.env.STT_BENCH ? 12 : 1); i++) {
    let writes = 0
    times = {}
    const stt = await GeminiTranscribeSTT.create({
      request: (body, consume) =>
        new Promise((resolve, reject) => {
          times.startRequest = performance.now()
          const req = request(
            {
              method: 'POST',
              host: '127.0.0.1',
              port: server.address().port,
              headers: { 'content-length': body.length, connection: 'close' },
            },
            async (res) => {
              times.firstResponse = performance.now()
              try {
                for await (const part of res) await consume(part)
                resolve()
              } catch (error) {
                reject(error)
              }
            },
          )
          req.on('error', reject)
          let encodeMs = 0
          const iter = body.read()[Symbol.iterator]()
          while (true) {
            const tick = performance.now()
            const part = iter.next()
            encodeMs += performance.now() - tick
            if (part.done) break
            assert.ok(part.value.length <= 4096)
            req.write(part.value)
            writes++
          }
          times.encodeMs = encodeMs
          req.end()
        }),
    }).open({
      ...createVoiceScope(),
      format: mono(16000),
      utteranceId: 'u',
      onTranscript: (event) => {
        times.final = performance.now()
        transcriptText = event.text
      },
    })
    await writeSink(stt.input, pcm)
    times.release = performance.now()
    await stt.finish()
    await stt.close()
    assert.equal(transcriptText, 'おはようございます')
    assert.deepEqual(Buffer.from(posted.input[0].data, 'base64').subarray(44), Buffer.from(pcm))
    observations.push({
      prepare: times.startRequest - times.release,
      encode: times.encodeMs,
      uploadIncludingEncode: times.peerReceived - times.startRequest,
      mockWait: times.firstResponse - times.peerReceived,
      parse: times.final - times.firstResponse,
      total: times.final - times.release,
      writes,
    })
  }
  if (process.env.STT_BENCH) {
    const warm = observations.slice(1)
    const medians = Object.fromEntries(
      Object.keys(warm[0]).map((k) => [
        k,
        +warm
          .map((v) => v[k])
          .sort((a, b) => a - b)[5]
          .toFixed(3),
      ]),
    )
    t.diagnostic(JSON.stringify(medians))
  }
  // TLS writes are significant on the wearable, even when the peer is ready.
  if (typeof Uint8Array.prototype.toBase64 === 'function')
    assert.ok(
      observations.every((v) => v.writes <= 18),
      'a 1.5 s utterance should use at most 18 bounded writes',
    )
})

test('STT timing contains only byte count and stage durations, including a tick wrap', async () => {
  let tick = 0xfffffff0
  const metrics = []
  const stt = await GeminiTranscribeSTT.create({
    timing: { now: () => tick >>> 0, emit: (fields) => metrics.push(fields) },
    request: async (body, consume) => {
      tick += 7
      const parts = body.read()[Symbol.iterator]()
      parts.next()
      tick += 11
      for (const _ of parts) {
      }
      tick += 23
      await consume(bytes(JSON.stringify(transcript('test'))))
      tick += 2
    },
  }).open({ ...createVoiceScope(), format: mono(16000), utteranceId: 'u', onTranscript() {} })
  await writeSink(stt.input, new Uint8Array(16))
  await stt.finish()
  await stt.close()
  assert.deepEqual(metrics, [[16, 7, 11, 23, 2]])
})

test('WAV base64 pads only at the end across exact native block boundaries', async () => {
  for (const length of [2, 3026, 3028, 3030, 6098, 6100, 6102]) {
    const pcm = Uint8Array.from({ length }, (_, i) => (i * 31 + (i >>> 6)) & 255)
    const stt = await GeminiTranscribeSTT.create({
      request: async (body, consume) => {
        const data = bodyJSON(body).value.input[0].data
        const wave = Buffer.from(data, 'base64')
        assert.equal(data, wave.toString('base64'))
        assert.equal(wave.readUInt32LE(40), length)
        assert.deepEqual(wave.subarray(44), Buffer.from(pcm))
        await consume(bytes(JSON.stringify(transcript('ok'))))
      },
    }).open({ ...createVoiceScope(), format: mono(16000), utteranceId: 'u', onTranscript() {} })
    await writeSink(stt.input, pcm)
    await stt.finish()
    await stt.close()
  }
})
