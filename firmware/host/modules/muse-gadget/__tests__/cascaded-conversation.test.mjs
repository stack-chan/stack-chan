import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { createMuseCascadedConversation } from '../cascaded-conversation.js'
import { createMuseChatAgent } from '../chat-agent.js'

registerHooks({
  resolve(specifier, context, next) {
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

function setup({ transcript = 'こんにちは', send, finish, failStt = false } = {}) {
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
      return sink
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
    createConversation: createCascadedConversation,
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
    tts: {
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

test('caption observation publishes complete synthesis text and keeps turns scoped', async () => {
  const f = setup({
    send: async () => ({ status: 'completed', messages: [{ id: 'reply', text: 'One sentence. Another sentence.' }] }),
  })
  const session = await f.conversation.open(f.options)
  const first = await session.submit(user('one'), f.scope)
  await first.done
  const second = await session.submit(user('two'), f.scope)
  await second.done
  const started = f.events.filter((event) => event.type === 'turn.started')
  for (const turn of started) {
    const segments = f.events.filter((event) => event.type === 'caption.segment' && event.turnId === turn.turnId)
    assert.equal(segments.map((event) => event.text).join(''), 'One sentence. Another sentence.')
    assert.ok(segments.every((event) => event.outputId.startsWith('reply/')))
  }
  assert.equal(started.length, 2)
  assert.notEqual(started[0].turnId, started[1].turnId)
  await session.close({ mode: 'drain' })
})

test('delayed caption observers retain their original output and preserve sink writes', async () => {
  const synthesisEnd = deferred(),
    playbackEnd = deferred(),
    sinkResult = Promise.resolve(),
    events = [],
    playback = []
  let config,
    inner,
    synthesisCount = 0
  const format = mono(24000)
  const conversation = createMuseCascadedConversation({
    createConversation(value) {
      config = value
      return {
        open(value) {
          inner = value
          return { id: 'test', close: async () => ({}) }
        },
      }
    },
    createPushToTalk: () => ({ detector: {}, release() {}, press() {} }),
    createAgent: () => ({ capabilities: {} }),
    openChat: async () => ({ close() {} }),
    stt: {},
    tts: {
      async open() {
        const first = synthesisCount++ === 0
        return {
          write: () => sinkResult,
          endInput: () => (first ? synthesisEnd.promise : Promise.resolve()),
        }
      },
    },
    onPlaybackState: (active, info) => playback.push({ active, info }),
  })
  await conversation.open({
    signal: new AbortController().signal,
    history: [],
    onEvent: (event) => events.push(event),
    media: {
      output: {
        format,
        begin: () => ({ write: () => sinkResult }),
        finish: () => playbackEnd.promise,
      },
    },
  })
  inner.onEvent({ type: 'turn.started', turnId: 'one' })
  const first = await config.tts.open({ format })
  const firstSink = inner.media.output.begin('same/0', 0)
  assert.equal(firstSink.write(new Uint8Array(8)), sinkResult)
  assert.equal(first.write('first'), sinkResult)
  const firstDone = first.endInput()
  firstSink.write(new Uint8Array(4))
  const firstStopped = inner.media.output.finish('same/0')

  inner.onEvent({ type: 'turn.started', turnId: 'two' })
  const second = await config.tts.open({ format })
  inner.media.output.begin('same/0', 0).write(new Uint8Array(24))
  second.write('second')
  await second.endInput()
  assert.equal(events.filter((event) => event.type === 'caption.duration').length, 1)
  const secondStopped = inner.media.output.finish('same/0')
  playbackEnd.resolve()
  await Promise.all([secondStopped, firstStopped])
  synthesisEnd.resolve()
  await firstDone

  assert.deepEqual(
    events
      .filter((event) => event.type === 'caption.duration')
      .map(({ turnId, durationMs }) => ({ turnId, durationMs })),
    [
      { turnId: 'one', durationMs: (6 / 24000) * 1000 },
      { turnId: 'two', durationMs: (12 / 24000) * 1000 },
    ],
  )
  assert.deepEqual(
    playback.filter(({ active }) => !active),
    [
      { active: false, info: { turnId: 'one', outputId: 'same/0' } },
      { active: false, info: { turnId: 'two', outputId: 'same/0' } },
    ],
  )
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
