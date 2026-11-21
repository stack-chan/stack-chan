import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { createMuseCascadedConversation } from '../cascaded-conversation.js'
import { createMuseChatAgent } from '../chat-agent.js'

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'gemini-worker-events') return next(new URL('../../voice/gemini-worker-events.js', import.meta.url).href, context)
    if (specifier === 'timer') return next(new URL('../../testing/fakes/timer.ts', import.meta.url).href, context)
    if (specifier.startsWith('stackchan/voice/'))
      return next(new URL(`../../voice/${specifier.slice(16)}.ts`, import.meta.url).href, context)
    return next(specifier, context)
  },
})
const { createCascadedConversation, createPushToTalk } = await import('../../voice/cascaded.ts')
const { createPcmSource, createPcmSink, pcmMedia, mono } = await import('../../voice/media.ts')
const { createVoiceScope, deferred } = await import('../../voice/scope.ts')
const tick = () => new Promise((resolve) => setImmediate(resolve))
const user = (text) => ({ type: 'message', role: 'user', content: [{ type: 'input_text', text }] })

function setup({ transcript = 'こんにちは', send, finish, failStt = false, tts, finalSpeech, allowStreaming } = {}) {
  const events = [],
    spoken = [],
    messages = [],
    playback = [],
    recordings = []
  const scope = createVoiceScope()
  const capture = createPcmSource(mono(16000), 2560)
  let generation = 0,
    closed = 0,
    sttClosed = 0,
    finishing = 0
  const sink = createPcmSink(mono(24000), () => {})
  const output = {
    ...sink,
    budget: { maxBufferedMs: 500, maxBufferedBytes: 24576 },
    begin(_id, epoch) {
      assert.equal(epoch, generation)
      return Object.assign(sink, { allowStreaming })
    },
    async finish(outputId) {
      await finish?.()
      return { outputId, generation, state: 'played', position: { basis: 'unknown' } }
    },
    async fence(next) {
      generation = next
      return []
    },
  }
  const conversation = createMuseCascadedConversation({
    createConversation: (config) => createCascadedConversation(config, finalSpeech),
    createPushToTalk,
    createAgent: createMuseChatAgent,
    async openChat() {
      return {
        async send(message, options) {
          messages.push(message)
          return send
            ? send(message, options)
            : { status: 'completed', messages: [{ id: 'reply', text: 'おはよう。' }] }
        },
        close() {
          closed++
        },
      }
    },
    stt: {
      async open({ format, signal, utteranceId, onTranscript }) {
        if (failStt) throw Object.assign(new Error('recognition failed'), { code: 'provider_failed' })
        return {
          input: createPcmSink(format, (bytes) => {
            recordings.push(...bytes)
          }),
          async finish() {
            finishing++
            await tick()
            assert.equal(signal.aborted, false)
            onTranscript({ utteranceId, text: transcript, final: true })
          },
          async close() {
            sttClosed++
          },
        }
      },
    },
    tts: tts ?? {
      async open({ format }) {
        const source = createPcmSource(format)
        return {
          output: source.output,
          async write(text) {
            spoken.push(text)
          },
          async endInput() {
            source.end()
          },
          async close() {
            source.end()
          },
        }
      },
    },
    voice: 'alloy',
    onPlaybackState: (active) => playback.push(active),
  })
  const options = {
    ...scope,
    media: { input: capture.output, output, media: pcmMedia },
    history: [],
    onEvent: (e) => events.push(e),
  }
  return {
    conversation,
    options,
    events,
    spoken,
    messages,
    playback,
    recordings,
    capture,
    scope,
    counts: () => ({ closed, sttClosed, finishing }),
  }
}

test('PTT release completes STT, sends only text to Muse, and speaks the answer once', async () => {
  const f = setup(),
    session = await f.conversation.open(f.options)
  await session.setInputEnabled(false)
  await session.setInputEnabled(true)
  await tick()
  await f.capture.push(new Uint8Array([1, 0, 2, 0]))
  await session.setInputEnabled(false)
  for (let i = 0; i < 20 && !f.events.some((e) => e.type === 'turn.ended'); i++) await tick()
  assert.deepEqual(f.recordings, [1, 0, 2, 0])
  assert.equal(
    f.events.some((e) => e.type === 'error'),
    false,
  )
  assert.deepEqual(f.messages, [{ message: 'こんにちは' }])
  assert.deepEqual(f.spoken, ['おはよう。'])
  assert.deepEqual(
    f.events.filter((e) => e.type === 'output.text').map((e) => e.delta),
    ['おはよう。'],
  )
  assert.equal(f.events.find((e) => e.type === 'turn.ended').status, 'completed')
  assert.equal(f.counts().finishing, 1)
  assert.deepEqual(f.playback, [true, false])
  await session.close({ mode: 'abort' })
  assert.equal(f.counts().closed, 1)
})

test('reply playback gates the next press and permits the next completed turn', async () => {
  const draining = deferred(),
    f = setup({ finish: () => draining.promise })
  const session = await f.conversation.open(f.options)
  const first = await session.submit(user('one'), f.scope)
  await tick()
  await assert.rejects(session.setInputEnabled(true), { code: 'device_busy' })
  await assert.rejects(session.submit(user('two'), f.scope), { code: 'device_busy' })
  draining.resolve()
  assert.equal((await first.done).status, 'completed')
  const second = await session.submit(user('two'), f.scope)
  assert.equal((await second.done).status, 'completed')
  assert.deepEqual(f.messages, [{ message: 'one' }, { message: 'two' }])
  await session.close({ mode: 'drain' })
})

test('empty transcript does not send and releases the next press', async () => {
  const f = setup({ transcript: '  ' }),
    session = await f.conversation.open(f.options)
  await session.setInputEnabled(true)
  await tick()
  await session.setInputEnabled(false)
  await tick()
  await tick()
  assert.equal(f.counts().finishing, 1)
  assert.equal(
    f.events.some((e) => e.type === 'error'),
    false,
  )
  await session.setInputEnabled(true)
  assert.equal(f.messages.length, 0)
  await session.close({ mode: 'abort' })
})

test('STT open failure permits retry without sending a Muse message', async () => {
  const f = setup({ failStt: true }),
    session = await f.conversation.open(f.options)
  await session.setInputEnabled(true)
  await tick()
  assert.equal(f.events.find((e) => e.type === 'error').fatal, false)
  await session.setInputEnabled(false)
  await session.setInputEnabled(true)
  await tick()
  assert.equal(f.events.filter((e) => e.type === 'error').length, 2)
  assert.equal(f.messages.length, 0)
  await session.close({ mode: 'abort' })
})

test('remote-owned history and user-only text are enforced', async () => {
  const f = setup()
  assert.equal(f.conversation.capabilities.interruption, 'local-only')
  assert.equal(f.conversation.capabilities.historyRepair, 'restart')
  assert.equal(f.conversation.capabilities.interruptionReuse, 'restart-required')
  await assert.rejects(f.conversation.open({ ...f.options, history: [user('old')] }), {
    code: 'unsupported_capability',
  })
  const session = await f.conversation.open(f.options)
  await assert.rejects(session.submit({ ...user('system'), role: 'system' }, f.scope), {
    code: 'unsupported_capability',
  })
  await assert.rejects(session.submit({ ...user('image'), content: [{ type: 'input_image' }] }, f.scope), {
    code: 'unsupported_capability',
  })
  assert.equal(f.messages.length, 0)
  await session.close({ mode: 'abort' })
})

test('cancelled Muse turn cannot reuse or claim remote cancellation', async () => {
  const f = setup({
    send: (_message, { signal }) =>
      new Promise((_, reject) =>
        signal.addEventListener('abort', () =>
          reject(Object.assign(new Error('uncertain'), { code: 'cancelled_unconfirmed' })),
        ),
      ),
  })
  const session = await f.conversation.open(f.options)
  const turn = await session.submit(user('work'), f.scope)
  await tick()
  const interrupted = await session.interrupt()
  assert.equal(interrupted.remote, 'unknown')
  assert.equal(interrupted.history, 'restart-required')
  assert.equal((await turn.done).status, 'interrupted')
  await assert.rejects(session.submit(user('retry'), f.scope), { code: 'cancelled_unconfirmed' })
  assert.equal((await session.close({ mode: 'abort' })).remoteFinalization, 'unknown')
})

test('Muse failure becomes fatal so a closed chat is not silently reused', async () => {
  const f = setup({
    send: async () => {
      throw new Error('transport lost')
    },
  })
  const session = await f.conversation.open(f.options)
  const turn = await session.submit(user('work'), f.scope)
  assert.equal((await turn.done).status, 'failed')
  assert.equal(f.events.find((e) => e.type === 'error').fatal, true)
  await assert.rejects(session.setInputEnabled(true), { code: 'cancelled_unconfirmed' })
  await session.close({ mode: 'abort' })
})

test('disconnect during recording closes STT without submitting', async () => {
  const f = setup(),
    session = await f.conversation.open(f.options)
  await session.setInputEnabled(true)
  await tick()
  await session.close({ mode: 'abort' })
  assert.equal(f.counts().sttClosed, 1)
  assert.equal(f.counts().finishing, 0)
  assert.equal(f.messages.length, 0)
})

test('drain immediately after accepted submit completes that turn', async () => {
  const f = setup(),
    session = await f.conversation.open(f.options)
  const accepted = session.submit(user('finish this'), f.scope)
  const closing = session.close({ mode: 'drain' })
  assert.equal((await (await accepted).done).status, 'completed')
  assert.equal((await closing).reason, 'drained')
  assert.deepEqual(f.messages, [{ message: 'finish this' }])
  assert.deepEqual(f.spoken, ['おはよう。'])
})

test('caller cancellation reports that the remote-owned session must restart', async () => {
  const f = setup({
    send: (_message, { signal }) =>
      new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))),
  })
  const session = await f.conversation.open(f.options)
  const caller = createVoiceScope()
  const accepted = await session.submit(user('work'), caller)
  await tick()
  caller.abort()
  assert.equal((await accepted.done).status, 'interrupted')
  assert.ok(f.events.some((e) => e.type === 'error' && e.fatal))
  await session.close({ mode: 'abort' })
})

test('interrupt closes active recognition without finishing or sending it', async () => {
  const f = setup(),
    session = await f.conversation.open(f.options)
  await session.setInputEnabled(true)
  await tick()
  assert.equal((await session.interrupt()).history, 'restart-required')
  assert.equal(f.counts().sttClosed, 1)
  assert.equal(f.counts().finishing, 0)
  assert.equal(f.messages.length, 0)
  await session.close({ mode: 'abort' })
})

const { createGeminiWorkerTTS } = await import('../../voice/gemini-worker-session.js')
const { synthesize } = await import('../../voice/gemini-worker-request.js')

function geminiFinalFixture(text, finalSpeech, afterAudio, allowStreaming) {
  ArrayBuffer.fromString ??= (s) => new TextEncoder().encode(s).buffer
  String.fromArrayBuffer ??= (buffer, offset = 0, length = buffer.byteLength - offset) =>
    new TextDecoder().decode(new Uint8Array(buffer, offset, length))
  Uint8Array.fromBase64 ??= (s) => new Uint8Array(Buffer.from(s, 'base64'))
  const requests = []
  // Run the Muse adapter, common pipeline, Gemini session and request encoder/parser; replace only the service.
  const tts = createGeminiWorkerTTS({}, (job) =>
    synthesize(async (body, consume, { signal }) => {
      const emit = (event) => consume(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
      const value = JSON.parse(Buffer.concat([...body.read()]).toString('utf8'))
      requests.push(value.input[0].content[0].text)
      await emit({ event_type: 'step.delta', delta: { type: 'audio', data: 'AQA=' } })
      await afterAudio?.(signal, emit)
      await emit({ event_type: 'interaction.completed', interaction: { status: 'completed' } })
    }, job),
  )
  const send = async () => ({ status: 'completed', messages: [{ id: 'reply', text }] })
  return { requests, ...setup({ tts, finalSpeech, send, allowStreaming }) }
}

async function runFinal(text, mode) {
  const f = geminiFinalFixture(text, mode)
  const session = await f.conversation.open(f.options)
  const turn = await session.submit(user('one'), f.scope)
  const result = await turn.done
  await session.close({ mode: 'drain' })
  return { ...f, result }
}

test('native Muse final grouping preserves the full text and uses one Gemini request instead of four', async () => {
  const text = '\u6700\u521d\u306e\u6587\u3002\u4e8c\u6587\u76ee\uff01\n\u6700\u5f8c\u306f\u7d75\u6587\u5b57\ud83d\udc2f\uff1f'
  const before = await runFinal(text)
  const after = await runFinal(text, 'bounded')
  assert.equal(before.result.status, 'completed')
  assert.equal(after.result.status, 'completed')
  assert.equal(before.requests.length, 4)
  assert.equal(before.requests.join(''), text)
  assert.deepEqual(after.requests, [text])
  assert.equal(after.messages.length, 1)
  assert.equal(after.playback.filter(Boolean).length, 1)
})

test('bounded final batching keeps text across chunks, avoids splitting pairs, preserves 4096-unit cap', async () => {
  const input = 'a'.repeat(239) + '\ud83d\udc2f' + 'b'.repeat(80) + '.' + 'c'.repeat(145) + '!' + 'd'.repeat(3628)
  assert.equal(input.length, 4096)
  const f = await runFinal(input, 'bounded')
  assert.equal(f.result.status, 'completed')
  assert.equal(f.requests.join(''), input)
  assert.equal(f.requests[0], 'a'.repeat(239))
  assert.ok(f.requests.every((s) => s.length <= 240 && !/[\uD800-\uDBFF]$/.test(s) && !/^[\uDC00-\uDFFF]/.test(s)))
  const tooLong = await runFinal(input + 'x', 'bounded')
  assert.equal(tooLong.result.status, 'failed')
  assert.deepEqual(tooLong.requests, [])
})

test('abort after partial audio never issues another bounded request, replays, or reports completion', async () => {
  const first = deferred()
  const text = 'a'.repeat(239) + '.' + 'b'.repeat(150)
  const f = geminiFinalFixture(text, 'bounded', (signal) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    first.resolve()
  }))
  const session = await f.conversation.open(f.options)
  const caller = createVoiceScope()
  const turn = await session.submit(user('one'), caller)
  await first.promise
  caller.abort()
  assert.equal((await turn.done).status, 'interrupted')
  assert.deepEqual(f.requests, [text.slice(0, 240)])
  assert.equal(f.messages.length, 1)
  assert.ok(!f.events.some((e) => e.type === 'output.playback' && e.receipt.state === 'played'))
  await assert.rejects(session.setInputEnabled(true), { code: 'cancelled_unconfirmed' })
  await session.close({ mode: 'abort' })
})

test('Gemini failure after a complete Muse reply permits the next spoken turn in the same session', async () => {
  const text = 'First sentence. Second sentence.'
  let fail = true
  const f = geminiFinalFixture(text, 'bounded', async (_signal, emit) => {
    if (!fail) return
    fail = false
    await emit({ event_type: 'interaction.failed' })
  })
  const session = await f.conversation.open(f.options)
  const first = await session.submit(user('read the reply'), f.scope)
  assert.equal((await first.done).status, 'failed')
  const errors = f.events.filter((event) => event.type === 'error')
  assert.deepEqual(
    errors.map(({ code, fatal }) => ({ code, fatal })),
    [{ code: 'provider_failed', fatal: false }],
  )

  await session.setInputEnabled(true)
  await tick()
  await f.capture.push(new Uint8Array([1, 0, 2, 0]))
  await session.setInputEnabled(false)
  const statuses = () => f.events.filter((event) => event.type === 'turn.ended').map((event) => event.status)
  for (let i = 0; i < 20 && statuses().length < 2; i++) await tick()
  assert.deepEqual(statuses(), ['failed', 'completed'])
  assert.deepEqual(f.messages, [{ message: 'read the reply' }, { message: 'こんにちは' }])
  assert.deepEqual(f.requests, [text, text])
  assert.deepEqual(
    f.events.filter((event) => event.type === 'output.playback').map((event) => event.receipt.state),
    ['played'],
  )
  assert.equal(f.counts().closed, 0)
  await session.close({ mode: 'drain' })
})

test('buffered playback is armed between the penultimate and final Gemini jobs', async () => {
  const text = 'a'.repeat(240) + 'b'.repeat(240) + 'c'.repeat(50)
  const requestCounts = []
  const f = geminiFinalFixture(text, 'buffered', undefined, () => requestCounts.push(f.requests.length))
  const session = await f.conversation.open(f.options)
  const first = await session.submit(user('read this'), f.scope)
  assert.equal((await first.done).status, 'completed')
  assert.deepEqual(f.requests.map((part) => part.length), [240, 240, 50])
  assert.deepEqual(requestCounts, [2])
  await session.close({ mode: 'drain' })
})

// Match the two-sentence capture without retaining the private words of that reply.
test('two final sentences need only one Gemini HTTP body in grouped mode', async () => {
  const text = 'First sentence. Second sentence.'
  assert.deepEqual((await runFinal(text)).requests, ['First sentence.', ' Second sentence.'])
  assert.deepEqual((await runFinal(text, 'bounded')).requests, [text])
})
