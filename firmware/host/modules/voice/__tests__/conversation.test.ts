import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { writeAliasPackage, writeAliasPackageSubpath } from '../../testing/node-alias-package.js'
import type {
  Agent,
  AgentResult,
  Conversation,
  ConversationEvent,
  DuplexLease,
  OutputMessage,
  PlaybackSink,
  STT,
  TTS,
} from '../contracts.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const local = resolve(root, 'voice')
writeAliasPackage(local, 'timer', resolve(root, 'testing/fakes/timer.js'), { hasDefaultExport: true })
writeAliasPackage(local, 'modules', resolve(root, 'testing/fakes/modules.js'), { hasDefaultExport: true })
for (const module of ['scope', 'media', 'pipeline', 'cascaded', 'runtime']) {
  writeAliasPackageSubpath(local, 'stackchan', `voice/${module}`, resolve(local, `${module}.js`))
}
const { createPcmSink, createPcmSource, mono, pcmMedia } = await import('../media.js')
const { createConversationPipeline } = await import('../pipeline.js')
const { bindAudioRuntime } = await import('../runtime.js')
const { createVoiceScope, deferred } = await import('../scope.js')
const timer = (await import('../../testing/fakes/timer.js')).default
const { createCascadedConversation, createPushToTalk } = await import('../cascaded.js')
const budget = { maxBufferedMs: 250, maxBufferedBytes: 24000 }

function makeLease() {
  const capture = createPcmSource(mono(16000), 2560)
  const samples: number[] = []
  let generation = 0
  const sink = createPcmSink(mono(24000), (bytes) => {
    samples.push(...bytes)
  })
  const output: PlaybackSink = {
    ...sink,
    budget,
    begin(_id, epoch) {
      assert.equal(epoch, generation)
      return sink
    },
    async finish(outputId) {
      return {
        outputId,
        generation,
        state: 'played',
        position: { basis: 'estimate', renderedFrames: samples.length / 2, sampleRate: 24000 },
      }
    },
    async fence(next) {
      assert.ok(next > generation)
      generation = next
      return []
    },
  }
  let closes = 0
  const lease: DuplexLease = {
    input: capture.output,
    output,
    media: pcmMedia,
    async setInputEnabled() {},
    setVolume() {},
    async close() {
      closes++
      capture.end()
    },
  }
  return { lease, capture, samples, closes: () => closes }
}
function successfulAgent(): Agent {
  return {
    async run({ input }) {
      assert.equal(input.at(-1)?.type, 'message')
      const message: OutputMessage = {
        id: 'out',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'はい。' }],
      }
      return { status: 'completed', response: { id: 'r', status: 'completed', output: [message] }, appended: [message] }
    },
  }
}
const tick = () => new Promise<void>((ok) => setImmediate(ok))

function silentSpeech(spoken: string[]): TTS {
  return {
    capabilities: { input: 'segmented', output: 'streaming' },
    async open({ format }) {
      const source = createPcmSource(format)
      return {
        output: source.output,
        async write(text) {
          spoken.push(text)
        },
        async flush() {},
        async endInput() {
          source.end()
        },
        async close() {
          source.end()
        },
      }
    },
  }
}

test('submitted turn receipt waits for playback and permits a second completed turn', async () => {
  const device = makeLease()
  const played = deferred<void>()
  const reachedPlayback = deferred<void>()
  const finish = device.lease.output.finish
  device.lease.output.finish = async (id) => {
    reachedPlayback.resolve()
    await played.promise
    return finish(id)
  }
  const conversation = createCascadedConversation({
    agent: successfulAgent(),
    tts: silentSpeech([]),
    stt: {
      async open() {
        throw new Error('unused')
      },
    },
    turnDetector: createPushToTalk().detector,
    voice: '',
  })
  const scope = createVoiceScope()
  const events: ConversationEvent[] = []
  const session = await conversation.open({
    ...scope,
    media: device.lease,
    history: [],
    onEvent: (e) => events.push(e),
  })
  const message = {
    type: 'message' as const,
    role: 'user' as const,
    content: [{ type: 'input_text' as const, text: 'hi' }],
  }
  try {
    const first = await session.submit(message, scope)
    assert.equal(first.completion, 'playback')
    if (first.completion !== 'playback') throw new Error('missing completion')
    let completed = false
    void first.done.then(() => {
      completed = true
    })
    await reachedPlayback.promise
    assert.equal(completed, false)
    await assert.rejects(session.submit(message, scope), { code: 'device_busy' })
    played.resolve()
    assert.deepEqual(await first.done, { turnId: first.id, status: 'completed' })
    const second = await session.submit(message, scope)
    if (second.completion !== 'playback') throw new Error('missing completion')
    assert.notEqual(second.id, first.id)
    assert.deepEqual(await second.done, { turnId: second.id, status: 'completed' })
    assert.deepEqual(
      events.filter((e) => e.type === 'turn.ended').map((e) => e.turnId),
      [first.id, second.id],
    )
  } finally {
    played.resolve()
    await session.close({ mode: 'abort' })
  }
})

test('speech segmentation bounds punctuation-free chunks and preserves Unicode and the final tail', async () => {
  const device = makeLease()
  const spoken: string[] = []
  const text = 'a'.repeat(239) + '😀' + 'b'.repeat(350) + '。tail'
  const reply: OutputMessage = {
    type: 'message',
    role: 'assistant',
    id: 'reply',
    phase: 'final_answer',
    content: [{ type: 'output_text', text }],
  }
  const conversation = createCascadedConversation({
    agent: {
      async run(_request, options) {
        await options.onEvent?.({
          type: 'response.output_text.delta',
          item_id: reply.id,
          phase: 'final_answer',
          delta: text.slice(0, -4),
        })
        return {
          status: 'completed',
          response: { id: 'response', status: 'completed', output: [reply] },
          appended: [reply],
        }
      },
    },
    tts: silentSpeech(spoken),
    stt: {
      async open() {
        throw new Error('unused')
      },
    },
    turnDetector: createPushToTalk().detector,
    voice: '',
  })
  const scope = createVoiceScope()
  const session = await conversation.open({ ...scope, media: device.lease, history: [], onEvent() {} })
  try {
    const turn = await session.submit(
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] },
      scope,
    )
    if (turn.completion !== 'playback') throw new Error('missing completion')
    assert.equal((await turn.done).status, 'completed')
    assert.equal(spoken.join(''), text)
    assert.ok(spoken.every((part) => part.length <= 240 && !/[\uD800-\uDBFF]$/.test(part)))
    assert.equal(spoken.at(-1), 'tail')
  } finally {
    await session.close({ mode: 'abort' })
  }
})

test('interrupt cancels remaining speech segments and a settled cascaded session accepts another turn', async () => {
  const device = makeLease()
  const spoken: string[] = []
  const reply: OutputMessage = {
    type: 'message',
    role: 'assistant',
    id: 'reply',
    content: [{ type: 'output_text', text: 'First.Second.tail' }],
  }
  const conversation = createCascadedConversation({
    agent: {
      async run() {
        return {
          status: 'completed',
          response: { id: 'response', status: 'completed', output: [reply] },
          appended: [reply],
        }
      },
    },
    tts: silentSpeech(spoken),
    stt: {
      async open() {
        throw new Error('unused')
      },
    },
    turnDetector: createPushToTalk().detector,
    voice: '',
  })
  const scope = createVoiceScope()
  let interrupted: ReturnType<import('../contracts.js').ConversationSession['interrupt']> | undefined
  const session = await conversation.open({
    ...scope,
    media: device.lease,
    history: [],
    onEvent(event) {
      if (event.type === 'output.playback' && !interrupted) interrupted = session.interrupt()
    },
  })
  const message = {
    type: 'message' as const,
    role: 'user' as const,
    content: [{ type: 'input_text' as const, text: 'hello' }],
  }
  try {
    const first = await session.submit(message, scope)
    if (first.completion !== 'playback') throw new Error('missing completion')
    assert.equal((await first.done).status, 'interrupted')
    assert.equal((await interrupted)?.history, 'conservative')
    assert.deepEqual(spoken, ['First.'])
    const second = await session.submit(message, scope)
    if (second.completion !== 'playback') throw new Error('missing completion')
    assert.equal((await second.done).status, 'completed')
    assert.deepEqual(spoken, ['First.', 'First.', 'Second.', 'tail'])
  } finally {
    await session.close({ mode: 'abort' })
  }
})

test('history finalization failure settles the receipt and event as failed', async () => {
  const device = makeLease()
  const events: ConversationEvent[] = []
  const conversation = createCascadedConversation({
    agent: {
      async run() {
        return {
          status: 'completed',
          response: { id: 'response', status: 'completed', output: [] },
          appended: [{ type: 'provider_item', id: 'oversized', provider: 'test', value: 'x'.repeat(40000) }],
        }
      },
    },
    tts: silentSpeech([]),
    stt: {
      async open() {
        throw new Error('unused')
      },
    },
    turnDetector: createPushToTalk().detector,
    voice: '',
  })
  const scope = createVoiceScope()
  const session = await conversation.open({
    ...scope,
    media: device.lease,
    history: [],
    onEvent: (event) => events.push(event),
  })
  try {
    const result = await session.submit(
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] },
      scope,
    )
    if (result.completion !== 'playback') throw new Error('missing completion')
    assert.deepEqual(await result.done, { turnId: result.id, status: 'failed' })
    assert.ok(events.some((event) => event.type === 'turn.ended' && event.status === 'failed'))
    assert.ok(events.some((event) => event.type === 'error' && event.fatal && event.code === 'resource_exhausted'))
  } finally {
    await session.close({ mode: 'abort' })
  }
})

test('abort close cancels STT startup while microphone muting awaits the pending utterance', async () => {
  const device = makeLease()
  const talk = createPushToTalk()
  const opening = deferred<import('../contracts.js').VoiceSignal>()
  const muting = deferred<void>()
  const stopped = deferred<void>()
  const backend = createCascadedConversation({
    agent: successfulAgent(),
    tts: silentSpeech([]),
    stt: {
      open({ signal }) {
        opening.resolve(signal)
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            stopped.resolve()
            reject(signal.reason)
          })
        })
      },
    },
    turnDetector: talk.detector,
    voice: '',
  })
  const conversation: Conversation = {
    ...backend,
    async open(options) {
      const session = await backend.open(options)
      return {
        ...session,
        setInputEnabled(enabled) {
          if (!enabled) muting.resolve()
          return session.setInputEnabled(enabled)
        },
      }
    },
  }
  const runtime = bindAudioRuntime({ acquireExclusive: () => () => {} }, () => device.lease)
  const pipeline = createConversationPipeline({
    microphone: runtime.microphone,
    speaker: runtime.speaker,
    conversation,
    mediaBudget: budget,
  })
  await pipeline.start()
  talk.press()
  const signal = await opening.promise
  const muted = pipeline.setMicrophoneMuted(true)
  await muting.promise
  assert.equal(signal.aborted, false)
  assert.equal(device.closes(), 0)
  const closing = pipeline.close({ mode: 'abort' })
  await stopped.promise
  await muted
  assert.equal((await closing).reason, 'aborted')
  assert.equal(signal.aborted, true)
  assert.equal(device.closes(), 1)
  await pipeline.close({ mode: 'abort' })
  assert.equal(device.closes(), 1)
})

for (const oldResult of ['completed', 'failed'] as const) {
  test(`a new press records immediately while cancelling an older transcription whose late result is ${oldResult}`, async () => {
    const device = makeLease()
    const talk = createPushToTalk()
    const firstFinishing = deferred<void>()
    const firstResult = deferred<void>()
    const recordings: number[][] = []
    const transcripts: string[] = []
    const events: ConversationEvent[] = []
    let active = 0
    let peak = 0
    let lateTranscript: (() => void) | undefined
    const backend = createCascadedConversation({
      agent: {
        async run({ input }) {
          const message = input.at(-1)
          if (message?.type === 'message')
            transcripts.push(message.content.map((part) => ('text' in part ? part.text : '')).join(''))
          return { status: 'completed', response: { id: 'reply', status: 'completed', output: [] }, appended: [] }
        },
      },
      tts: silentSpeech([]),
      stt: {
        async open({ format, utteranceId, onTranscript, signal }) {
          const index = recordings.length
          const samples: number[] = []
          recordings.push(samples)
          active++
          peak = Math.max(peak, active)
          let closed = false
          if (index === 0) lateTranscript = () => onTranscript({ utteranceId, text: 'stale', final: true })
          return {
            input: createPcmSink(format, (bytes) => {
              samples.push(...bytes)
            }),
            async finish() {
              if (index === 0) {
                firstFinishing.resolve()
                await firstResult.promise
                onTranscript({ utteranceId, text: 'stale', final: true })
              } else onTranscript({ utteranceId, text: 'second', final: true })
            },
            async close() {
              assert.equal(signal.aborted, true)
              if (!closed) active--
              closed = true
            },
          }
        },
      },
      turnDetector: talk.detector,
      voice: '',
    })
    const session = await backend.open({
      ...createVoiceScope(),
      media: device.lease,
      history: [],
      onEvent: (event) => events.push(event),
    })
    try {
      talk.press()
      await tick()
      await device.capture.push(new Uint8Array(3200).fill(1))
      talk.release()
      await firstFinishing.promise
      talk.press()
      await tick()
      assert.equal(recordings.length, 2, 'a pending HTTP transcription must not hold the next microphone attachment')
      assert.equal(active, 1)
      assert.equal(peak, 1, 'close the previous STT before allocating its replacement')
      await device.capture.push(new Uint8Array(6000).fill(2))
      assert.deepEqual(
        recordings[1].slice(-6000),
        Array(6000).fill(2),
        'capture the whole utterance beyond 80 ms pre-roll',
      )
      lateTranscript?.()
      if (oldResult === 'completed') firstResult.resolve()
      else firstResult.reject(new Error('late old transcription failure'))
      await tick()
      assert.equal(active, 1, 'late completion must not close the current STT')
      assert.equal(events.filter((event) => event.type === 'error').length, 0)
      talk.release()
      await tick()
      await tick()
      assert.deepEqual(transcripts, ['second'])
      assert.equal(active, 0)
    } finally {
      firstResult.resolve()
      await session.close({ mode: 'abort' })
    }
  })
}

test('a final transcript does not commit before its asynchronous finish succeeds', async () => {
  const device = makeLease()
  const talk = createPushToTalk()
  const finishing = deferred<void>()
  const result = deferred<void>()
  let turns = 0
  const backend = createCascadedConversation({
    agent: {
      async run() {
        turns++
        return { status: 'completed', response: { id: 'reply', status: 'completed', output: [] }, appended: [] }
      },
    },
    tts: silentSpeech([]),
    stt: {
      async open({ format, utteranceId, onTranscript }) {
        return {
          input: createPcmSink(format, () => {}),
          async finish() {
            onTranscript({ utteranceId, text: 'complete', final: true })
            finishing.resolve()
            await result.promise
          },
          async close() {},
        }
      },
    },
    turnDetector: talk.detector,
    voice: '',
  })
  const session = await backend.open({ ...createVoiceScope(), media: device.lease, history: [], onEvent() {} })
  try {
    talk.press()
    await tick()
    talk.release()
    await finishing.promise
    await tick()
    assert.equal(turns, 0)
    result.resolve()
    await tick()
    await tick()
    assert.equal(turns, 1)
    talk.press()
    await tick()
    talk.release()
    await tick()
    await tick()
    assert.equal(turns, 2, 'a completed transcription remains committed when the next press starts')
  } finally {
    result.resolve()
    await session.close({ mode: 'abort' })
  }
})

test('failed STT cleanup quarantines the microphone lease and never opens a replacement', async () => {
  const device = makeLease()
  const talk = createPushToTalk()
  const finishing = deferred<void>()
  const result = deferred<void>()
  const failure = new Error('STT release unconfirmed')
  const events: ConversationEvent[] = []
  let opens = 0
  let closes = 0
  const conversation = createCascadedConversation({
    agent: successfulAgent(),
    tts: silentSpeech([]),
    stt: {
      async open({ format }) {
        opens++
        return {
          input: createPcmSink(format, () => {}),
          async finish() {
            finishing.resolve()
            await result.promise
          },
          async close() {
            closes++
            throw failure
          },
        }
      },
    },
    turnDetector: talk.detector,
    voice: '',
  })
  const runtime = bindAudioRuntime({ acquireExclusive: () => () => {} }, () => device.lease)
  const pipeline = createConversationPipeline({
    microphone: runtime.microphone,
    speaker: runtime.speaker,
    conversation,
    mediaBudget: budget,
    onEvent: (event) => events.push(event),
  })
  await pipeline.start()
  talk.press()
  await tick()
  talk.release()
  await finishing.promise
  talk.press()
  await tick()
  assert.equal(opens, 1)
  assert.equal(closes, 1)
  assert.ok(events.some((event) => event.type === 'error' && event.fatal))
  talk.release()
  talk.press()
  await tick()
  assert.equal(opens, 1)
  await assert.rejects(pipeline.close({ mode: 'abort' }), failure)
  await assert.rejects(pipeline.close({ mode: 'abort' }), failure)
  assert.equal(device.closes(), 0, 'a failed backend release must not return the audio lease for reuse')
  assert.equal(closes, 1)
  result.resolve()
  await tick()
})

test('interrupting a production Agent with an unsettled ToolSet operation requires a new session', async () => {
  const { createAgent, createToolSet } = await import('../../ai/ai-core.js')
  const work = deferred<string>()
  const started = deferred<void>()
  let active = 0
  const tools = createToolSet([
    {
      definition: {
        type: 'function',
        name: 'work',
        description: 'work',
        parameters: { type: 'object', properties: {} },
      },
      execute() {
        active++
        started.resolve()
        return work.promise.finally(() => {
          active--
        })
      },
    },
  ])
  const device = makeLease()
  const conversation = createCascadedConversation({
    agent: createAgent({
      llm: {
        capabilities: { image: false, tools: true },
        async createResponse() {
          return {
            status: 'completed',
            id: 'response',
            output: [{ type: 'function_call', id: 'item', call_id: 'call', name: 'work', arguments: '{}' }],
          }
        },
      },
      tools,
      instructions: '',
      maxToolRounds: 1,
    }),
    tts: silentSpeech([]),
    stt: {
      async open() {
        throw new Error('unused')
      },
    },
    turnDetector: createPushToTalk().detector,
    voice: '',
  })
  const scope = createVoiceScope()
  const session = await conversation.open({ ...scope, media: device.lease, history: [], onEvent() {} })
  const message = {
    type: 'message' as const,
    role: 'user' as const,
    content: [{ type: 'input_text' as const, text: 'work' }],
  }
  try {
    const first = await session.submit(message, scope)
    assert.equal(first.completion, 'playback')
    await started.promise
    const interruption = await session.interrupt()
    assert.equal(interruption.history, 'restart-required')
    assert.equal(active, 1, 'interrupting the wait does not claim that the real operation stopped')
    if (first.completion !== 'playback') throw new Error('missing completion')
    assert.equal((await first.done).status, 'interrupted')
    await assert.rejects(session.submit(message, scope), { code: 'provider_failed' })
    work.resolve('done')
    await tick()
    assert.equal(active, 0)
    await assert.rejects(session.submit(message, scope), { code: 'provider_failed' })
    assert.equal((await session.close({ mode: 'abort' })).remoteFinalization, 'unknown')
  } finally {
    work.resolve('done')
    await session.close({ mode: 'abort' })
  }
})

test('text-only agents reject images before retaining input and accept the next text turn', async () => {
  for (const capabilities of [undefined, { image: false }]) {
    const device = makeLease()
    const received: import('../contracts.js').InputItem[][] = []
    const conversation = createCascadedConversation({
      agent: {
        capabilities,
        async run({ input }) {
          received.push([...input])
          return { status: 'completed', response: { id: 'text', status: 'completed', output: [] }, appended: [] }
        },
      },
      tts: silentSpeech([]),
      stt: {
        async open() {
          throw new Error('unused')
        },
      },
      turnDetector: createPushToTalk().detector,
      voice: '',
    })
    assert.equal(conversation.capabilities.imageInput, false)
    const scope = createVoiceScope()
    const image: import('../contracts.js').InputMessage = {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_image', image_url: 'https://example.test/image.png' }],
    }
    await assert.rejects(conversation.open({ ...scope, media: device.lease, history: [image], onEvent() {} }), {
      code: 'unsupported_capability',
    })
    const session = await conversation.open({ ...scope, media: device.lease, history: [], onEvent() {} })
    try {
      await assert.rejects(session.submit(image, scope), { code: 'unsupported_capability' })
      await assert.rejects(
        session.submit(
          { ...image, content: [{ type: 'input_image', image: { format: 'jpeg', data: new Uint8Array(65536) } }] },
          scope,
        ),
        { code: 'unsupported_capability' },
      )
      assert.equal(received.length, 0)
      const text: import('../contracts.js').InputMessage = {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'hello' }],
      }
      const submitted = await session.submit(text, scope)
      if (submitted.completion !== 'playback') throw new Error('missing completion')
      assert.equal((await submitted.done).status, 'completed')
      assert.deepEqual(JSON.parse(JSON.stringify(received)), [[text]])
    } finally {
      await session.close({ mode: 'abort' })
    }
  }
})

test('image-capable agents opt in while image ownership and history budgets remain enforced', async () => {
  const device = makeLease()
  let received: readonly import('../contracts.js').InputItem[] = []
  const conversation = createCascadedConversation({
    agent: {
      capabilities: { image: true },
      async run({ input }) {
        received = input
        return { status: 'completed', response: { id: 'image', status: 'completed', output: [] }, appended: [] }
      },
    },
    tts: silentSpeech([]),
    stt: {
      async open() {
        throw new Error('unused')
      },
    },
    turnDetector: createPushToTalk().detector,
    voice: '',
  })
  assert.equal(conversation.capabilities.imageInput, true)
  const scope = createVoiceScope()
  const seed: import('../contracts.js').InputMessage = {
    type: 'message',
    role: 'user',
    content: [{ type: 'input_image', image_url: 'https://example.test/seed.png' }],
  }
  const session = await conversation.open({ ...scope, media: device.lease, history: [seed], onEvent() {} })
  try {
    await assert.rejects(
      session.submit(
        { ...seed, content: [{ type: 'input_image', image: { format: 'jpeg', data: new Uint8Array(65536) } }] },
        scope,
      ),
      { code: 'resource_exhausted' },
    )
    const pixels = Uint8Array.of(1, 2)
    const submitted = session.submit(
      { ...seed, content: [{ type: 'input_image', image: { format: 'jpeg', data: pixels } }] },
      scope,
    )
    pixels[0] = 9
    const turn = await submitted
    if (turn.completion !== 'playback') throw new Error('missing completion')
    assert.equal((await turn.done).status, 'completed')
    assert.equal(received.length, 2)
    const message = received[1]
    assert.ok(message.type === 'message' && message.role === 'user')
    const part = message.content[0]
    assert.ok(part.type === 'input_image' && 'image' in part)
    assert.deepEqual([...part.image.data], [1, 2])
  } finally {
    await session.close({ mode: 'abort' })
  }
})

test('device lease bounds pending audio, retains queued samples and fences stale producers', async () => {
  const { createAudioRuntime } = await import('../pcm-device.js')
  const { resetModules } = await import('../../testing/fakes/modules.js')
  const { writeSink } = await import('../media.js')
  let inputs = 0,
    output: Output
  class Input {
    channels = 1
    sampleRate = 16000
    start() {
      inputs++
    }
    close() {
      inputs--
    }
  }
  class Output {
    static Volume = 4
    static Callback = 3
    static RawSamples = 5
    callback: (id: number) => void
    buffers: Uint8Array[] = []
    closed = false
    constructor() {
      output = this
    }
    enqueue(_stream, kind, pin, _repeat?, _offset?, count?) {
      if (kind === 5) this.buffers.push(new Uint8Array(pin, 0, count * 2))
    }
    start() {}
    stop() {}
    close() {
      this.closed = true
    }
  }
  resetModules({ 'audio-in': Input, 'pins/audioout': Output })
  let reserved = false
  const runtime = createAudioRuntime({
    acquireExclusive() {
      reserved = true
      return () => {
        reserved = false
      }
    },
  })
  const lease = await runtime.acquire(
    runtime.microphone,
    runtime.speaker,
    { input: [mono(16000)], output: [mono(24000)], duplex: 'half' },
    { ...createVoiceScope(), budget },
  )
  const writer = lease.output.begin('one', 0)
  assert.equal(inputs, 0)
  const packet = Uint8Array.of(1, 2)
  await writeSink(writer, packet)
  packet[0] = 9
  await writeSink(writer, packet)
  assert.equal(output.buffers.length, 0)
  timer.advance(20)
  assert.deepEqual([...output.buffers[0]], [1, 2, 9, 2])
  await writeSink(writer, new Uint8Array(2048))
  let thirdAccepted = false
  const third = writeSink(writer, packet).then(() => {
    thirdAccepted = true
  })
  await tick()
  assert.equal(thirdAccepted, false)
  output.callback(1)
  await third
  const pending = lease.output.finish('one')
  assert.deepEqual([...output.buffers[2]], [9, 2])
  const [cut] = await lease.output.fence(1)
  assert.deepEqual(await pending, cut)
  assert.deepEqual(cut.position, { basis: 'estimate', sampleRate: 24000, renderedFrames: 2 })
  assert.equal(inputs, 1)
  assert.ok(output.closed)
  await assert.rejects(writeSink(writer, packet))
  const partial = lease.output.begin('two', 1)
  await writeSink(partial, packet)
  const oldOutput = output
  await lease.output.fence(2)
  timer.advance(100)
  assert.equal(oldOutput.buffers.length, 0)
  await lease.close()
  assert.deepEqual([inputs, reserved], [0, false])

  resetModules({
    'audio-in': Input,
    'pins/audioout': Output,
    'stackchan/voice/cores3-pcm-output': {
      minimumOutputBytes: 10240,
      openOutput() {
        assert.fail('DMA exceeds tiny budget')
      },
    },
  })
  const tiny = await runtime.acquire(
    runtime.microphone,
    runtime.speaker,
    { input: [mono(16000)], output: [mono(24000)], duplex: 'half' },
    { ...createVoiceScope(), budget: { maxBufferedMs: 1, maxBufferedBytes: 48 } },
  )
  await writeSink(tiny.output.begin('short', 0), packet)
  assert.deepEqual([...output.buffers[0]], [...packet])
  const drained = tiny.output.finish('short')
  output.callback(1)
  assert.equal((await drained).state, 'played')
  await tiny.close()
})

test('CoreS3 output grants ring credit after write and drains a final partial DMA block', async () => {
  const hook = registerHooks({
    resolve(specifier, context, next) {
      if (specifier === 'embedded:io/audio/out')
        return { shortCircuit: true, url: new URL('../../testing/fakes/audio-out.js', import.meta.url).href }
      return next(specifier, context)
    },
  })
  const driver = await import('../cores3-pcm-output.js')
  hook.deregister()
  const { resetModules } = await import('../../testing/fakes/modules.js')
  const { getAudioOutInstances } = await import('../../testing/fakes/audio-out.js')
  const { createAudioRuntime } = await import('../pcm-device.js')
  class Input {
    channels = 1
    sampleRate = 16000
    start() {}
    close() {}
  }
  resetModules({ 'audio-in': Input, 'stackchan/voice/cores3-pcm-output': driver })
  const runtime = createAudioRuntime({ acquireExclusive: () => () => {} })
  const lease = await runtime.acquire(
    runtime.microphone,
    runtime.speaker,
    { input: [mono(16000)], output: [mono(24000)], duplex: 'half' },
    { ...createVoiceScope(), budget },
  )
  const platform = globalThis as typeof globalThis & { amp?: { sampleRate: number } }
  const previousAmp = platform.amp
  platform.amp = { sampleRate: 0 }
  try {
    const sink = lease.output.begin('ring', 0) as import('../contracts.js').AudioSink & {
      writeBorrowed(bytes: Uint8Array, accepted: (n: number) => void): Promise<void>
    }
    assert.equal(platform.amp.sampleRate, 24000)
    const device = getAudioOutInstances().at(-1)
    assert.ok(device)
    const credit = device.options.onWritable
    assert.ok(credit)
    const pcm = new Uint8Array(14000).fill(73)
    const accepted: number[] = []
    const writing = sink.writeBorrowed(pcm, (size) => {
      assert.equal(device.writes.at(-1)?.length, size)
      accepted.push(size)
    })
    assert.deepEqual(accepted, [])
    credit(10240)
    await tick()
    assert.deepEqual(accepted, [10240])
    credit(4096)
    await writing
    assert.deepEqual(accepted, [10240, 3760])
    pcm.fill(0)
    assert.ok(device.writes.every((part) => part.every((x) => x === 73)))
    let completed = false
    const done = lease.output.finish('ring').then((result) => {
      completed = true
      return result
    })
    await tick()
    assert.equal(completed, false)
    credit(10240)
    await tick()
    credit(10240)
    await tick()
    assert.equal(completed, false)
    credit(10240)
    const receipt = await done
    assert.deepEqual(receipt.position, { basis: 'estimate', sampleRate: 24000, renderedFrames: 7000 })
    assert.equal(receipt.state, 'played')
    assert.ok(device.writes.slice(2).every((part) => part.every((x) => x === 0)))

    const next = lease.output.begin('cancel', 0) as typeof sink
    const lateCredit = getAudioOutInstances().at(-1)?.options.onWritable
    assert.ok(lateCredit)
    const blocked = next.writeBorrowed(pcm, () => assert.fail('credit after fence'))
    await lease.output.fence(1)
    await assert.rejects(blocked, /cancelled/)
    lateCredit(10240)
  } finally {
    if (previousAmp) platform.amp = previousAmp
    else delete platform.amp
    await lease.close()
  }
})

test('button utterance carries pre-roll into STT and plays synthesized PCM through the borrowed sink', async () => {
  const device = makeLease(),
    talk = createPushToTalk(),
    received: number[] = [],
    events: ConversationEvent[] = []
  const stt: STT = {
    async open({ format, utteranceId, onTranscript }) {
      return {
        input: createPcmSink(format, (bytes) => {
          received.push(...bytes)
        }),
        async close() {},
        async finish() {
          onTranscript({ utteranceId, text: 'hello', final: true })
        },
      }
    },
  }
  const tts: TTS = {
    capabilities: { input: 'segmented', output: 'streaming' },
    async open({ format }) {
      const source = createPcmSource(format)
      return {
        output: source.output,
        async write(text) {
          assert.equal(text, 'はい。')
          await source.push(Uint8Array.of(4, 5))
        },
        async flush() {},
        async endInput() {
          source.end()
        },
        async close() {},
      }
    },
  }
  const model = createCascadedConversation({
    stt,
    tts,
    agent: successfulAgent(),
    turnDetector: talk.detector,
    voice: 'test',
  })
  const runtime = bindAudioRuntime({ acquireExclusive: () => () => {} }, () => device.lease)
  const pipeline = createConversationPipeline({
    microphone: runtime.microphone,
    speaker: runtime.speaker,
    conversation: model,
    mediaBudget: budget,
    onEvent: (e) => events.push(e),
  })
  await pipeline.start()
  assert.equal(device.capture.offer(Uint8Array.of(1, 2)), undefined)
  talk.press()
  await tick()
  assert.equal(device.capture.offer(Uint8Array.of(3, 4)), undefined)
  talk.release()
  await tick()
  assert.deepEqual(received, [1, 2, 3, 4])
  assert.deepEqual(device.samples, [4, 5])
  assert.ok(events.some((e) => e.type === 'turn.ended' && e.status === 'completed'))
  assert.equal((await pipeline.close({ mode: 'drain' })).reason, 'drained')
  assert.equal(device.closes(), 1)
})

test('only a confirmed final-answer sentence starts early and the completed reply plays its remaining suffix once', async () => {
  const device = makeLease(),
    talk = createPushToTalk(),
    speaking: string[] = []
  const early = deferred<void>(),
    finish = deferred<void>(),
    ended = deferred<void>()
  const reply: OutputMessage = {
    type: 'message',
    role: 'assistant',
    id: 'reply',
    phase: 'final_answer',
    content: [{ type: 'output_text', text: '一。二。' }],
  }
  const agent: Agent = {
    async run(_request, options) {
      await options.onEvent?.({ type: 'response.output_text.delta', item_id: 'maybe', delta: '準備。' })
      await options.onEvent?.({
        type: 'response.output_text.delta',
        item_id: 'reply',
        phase: 'final_answer',
        delta: '一。二',
      })
      early.resolve()
      await finish.promise
      return { status: 'completed', response: { id: 'r', status: 'completed', output: [reply] }, appended: [reply] }
    },
  }
  const tts: TTS = {
    capabilities: { input: 'segmented', output: 'streaming' },
    async open({ format }) {
      const source = createPcmSource(format)
      return {
        output: source.output,
        async write(s) {
          speaking.push(s)
          await source.push(Uint8Array.of(0, 0))
        },
        async flush() {},
        async endInput() {
          source.end()
        },
        async close() {},
      }
    },
  }
  const model = createCascadedConversation({
    agent,
    tts,
    stt: {
      async open() {
        throw Error('unused')
      },
    },
    voice: '',
    turnDetector: talk.detector,
  })
  const scope = createVoiceScope()
  const session = await model.open({
    ...scope,
    media: device.lease,
    history: [],
    onEvent(event) {
      if (event.type === 'turn.ended') ended.resolve()
    },
  })
  await session.submit({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'はい' }] }, scope)
  await early.promise
  assert.deepEqual(speaking, ['一。'])
  finish.resolve()
  await ended.promise
  assert.deepEqual(speaking, ['一。', '二。'])
  await session.close({ mode: 'drain' })
})

test('failed agent results preserve recognized error codes without publishing provider messages', async () => {
  for (const code of ['deadline_exceeded', 'provider_failed'] as const) {
    const device = makeLease()
    const scope = createVoiceScope()
    const ended = deferred<void>()
    const events: ConversationEvent[] = []
    let reason: unknown
    const conversation = createCascadedConversation({
      agent: {
        async run(_request, { signal }) {
          signal.addEventListener('abort', () => {
            reason = signal.reason
          })
          return { status: 'failed', error: { code, message: 'private provider detail' }, appended: [] }
        },
      },
      stt: {
        async open() {
          throw new Error('unused')
        },
      },
      tts: {
        capabilities: { input: 'segmented', output: 'streaming' },
        async open() {
          throw new Error('unused')
        },
      },
      voice: '',
      turnDetector: createPushToTalk().detector,
    })
    const session = await conversation.open({
      ...scope,
      media: device.lease,
      history: [],
      onEvent(event) {
        events.push(event)
        if (event.type === 'turn.ended') ended.resolve()
      },
    })
    try {
      await session.submit({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] }, scope)
      await ended.promise
      assert.deepEqual(
        events.filter((event) => event.type === 'error'),
        [{ type: 'error', code, fatal: false }],
      )
      const last = events.at(-1)
      assert.equal(last?.type, 'turn.ended')
      assert.ok(last?.type === 'turn.ended' && last.status === 'failed')
      assert.ok(reason instanceof Error)
      assert.equal(reason.message, 'private provider detail')
    } finally {
      await session.close({ mode: 'abort' })
    }
  }
})

test('a failed agent turn cancels its detached speech consumer before fencing playback', async () => {
  const device = makeLease()
  const started = deferred<void>()
  const cancelled = deferred<void>()
  const ended = deferred<void>()
  const events: ConversationEvent[] = []
  const cleanup: string[] = []
  let consumer: Promise<unknown> | undefined
  const fence = device.lease.output.fence
  device.lease.output.fence = async (generation) => {
    cleanup.push('fence')
    return fence(generation)
  }
  const agent: Agent = {
    async run(_request, options) {
      consumer = Promise.resolve(
        options.onEvent?.({
          type: 'response.output_text.delta',
          item_id: 'reply',
          phase: 'final_answer',
          delta: '途中。',
        }),
      ).then(
        () => undefined,
        (error) => error,
      )
      await started.promise
      return { status: 'failed', error: { code: 'provider_failed', message: 'connection failed' }, appended: [] }
    },
  }
  const tts: TTS = {
    capabilities: { input: 'segmented', output: 'streaming' },
    async open({ signal, format }) {
      const source = createPcmSource(format)
      const abort = () => {
        cleanup.push('cancel')
        source.end(signal.reason)
        cancelled.reject(signal.reason)
      }
      signal.addEventListener('abort', abort)
      return {
        output: source.output,
        async write() {},
        async flush() {},
        endInput() {
          started.resolve()
          return cancelled.promise
        },
        async close() {
          cleanup.push('close')
          signal.removeEventListener('abort', abort)
          source.end()
        },
      }
    },
  }
  const conversation = createCascadedConversation({
    agent,
    tts,
    stt: {
      async open() {
        throw Error('unused')
      },
    },
    voice: '',
    turnDetector: createPushToTalk().detector,
  })
  const scope = createVoiceScope()
  const session = await conversation.open({
    ...scope,
    media: device.lease,
    history: [],
    onEvent(event) {
      events.push(event)
      if (event.type === 'turn.ended') ended.resolve()
    },
  })
  try {
    await session.submit({ type: 'message', role: 'user', content: [{ type: 'input_text', text: '話して' }] }, scope)
    await ended.promise
    await tick()
    assert.deepEqual(cleanup, ['cancel', 'fence', 'close'])
    assert.equal(((await consumer) as { code?: string }).code, 'provider_failed')
    assert.deepEqual(
      events.filter((event) => event.type === 'error'),
      [{ type: 'error', code: 'provider_failed', fatal: false }],
    )
    assert.ok(events.some((event) => event.type === 'turn.ended' && event.status === 'failed'))
  } finally {
    cancelled.reject(Error('test cleanup'))
    await consumer
    await session.close({ mode: 'abort' })
  }
})

test('transcription failures preserve recognized codes and normalize provider-specific details', async () => {
  const failures = [
    {
      error: Object.assign(new Error('private timeout detail'), { code: 'deadline_exceeded' }),
      code: 'deadline_exceeded',
    },
    { error: Object.assign(new Error('private HTTP detail'), { code: 'http_429' }), code: 'provider_failed' },
    { error: new Error('private provider detail'), code: 'provider_failed' },
  ]
  for (const stage of ['open', 'finish']) {
    for (const failure of failures) {
      const device = makeLease()
      const talk = createPushToTalk()
      const failed = deferred<ConversationEvent>()
      const conversation = createCascadedConversation({
        agent: successfulAgent(),
        stt: {
          async open({ format }) {
            if (stage === 'open') throw failure.error
            return {
              input: createPcmSink(format, () => {}),
              async finish() {
                throw failure.error
              },
              async close() {},
            }
          },
        },
        tts: {
          capabilities: { input: 'segmented', output: 'streaming' },
          async open() {
            throw new Error('unused')
          },
        },
        voice: '',
        turnDetector: talk.detector,
      })
      const session = await conversation.open({
        ...createVoiceScope(),
        media: device.lease,
        history: [],
        onEvent(event) {
          if (event.type === 'error') failed.resolve(event)
        },
      })
      try {
        talk.press()
        talk.release()
        assert.deepEqual(await failed.promise, { type: 'error', code: failure.code, fatal: false })
      } finally {
        await session.close({ mode: 'abort' })
      }
    }
  }
})

test('agent rejections normalize unknown provider codes without exposing their details', async () => {
  for (const failure of [
    new Error('private provider detail'),
    { code: 'http_429', message: 'private HTTP detail' },
    null,
  ]) {
    const device = makeLease()
    const scope = createVoiceScope()
    const ended = deferred<void>()
    const events: ConversationEvent[] = []
    const conversation = createCascadedConversation({
      agent: {
        async run() {
          throw failure
        },
      },
      stt: {
        async open() {
          throw new Error('unused')
        },
      },
      tts: {
        capabilities: { input: 'segmented', output: 'streaming' },
        async open() {
          throw new Error('unused')
        },
      },
      voice: '',
      turnDetector: createPushToTalk().detector,
    })
    const session = await conversation.open({
      ...scope,
      media: device.lease,
      history: [],
      onEvent(event) {
        events.push(event)
        if (event.type === 'turn.ended') ended.resolve()
      },
    })
    try {
      await session.submit({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] }, scope)
      await ended.promise
      assert.deepEqual(
        events.filter((event) => event.type === 'error'),
        [{ type: 'error', code: 'provider_failed', fatal: false }],
      )
      const last = events.at(-1)
      assert.ok(last?.type === 'turn.ended' && last.status === 'failed')
    } finally {
      await session.close({ mode: 'abort' })
    }
  }
})

test('HTTP PCM waits for playback credit, carries a split sample, and rejects a truncated stream', async () => {
  const { createPcmBodyReader } = await import('../pcm-http.js')
  const credit = deferred<void>(),
    complete = deferred<void>(),
    calls: number[][] = []
  let read = 0
  const body = {
    read(target: Uint8Array) {
      for (let i = 0; i < target.length; i++) target[i] = ++read
      return target.length
    },
  }
  const receiver = createPcmBodyReader(
    async (bytes) => {
      calls.push([...bytes])
      if (calls.length === 1) await credit.promise
    },
    (error) => {
      if (error) complete.reject(error)
      else complete.resolve()
    },
  )
  receiver.ready(body, 3)
  receiver.ready(body, 3)
  receiver.done()
  assert.equal(read, 3)
  credit.resolve()
  await complete.promise
  assert.deepEqual(calls, [
    [1, 2],
    [3, 4, 5, 6],
  ])
  const invalid = deferred<unknown>()
  const truncated = createPcmBodyReader(
    async () => {},
    (error) => invalid.resolve(error),
  )
  truncated.ready(body, 1)
  truncated.done()
  assert.match(String(await invalid.promise), /truncated PCM sample/)
  const stopped = createPcmBodyReader(
    async () => {
      throw Error('unexpected write')
    },
    () => {
      throw Error('unexpected completion')
    },
  )
  stopped.close()
  stopped.ready(body, 2)
  assert.equal(read, 7)
})

test('HTTP PCM drains the current notification immediately while the speaker has credit', async () => {
  const { createPcmBodyReader } = await import('../pcm-http.js')
  const chunks: number[] = []
  const receiver = createPcmBodyReader(
    (bytes) => {
      chunks.push(bytes.length)
    },
    (error) => {
      assert.equal(error, undefined)
    },
  )
  receiver.ready({ read: (target) => target.length }, 4608)
  assert.deepEqual(chunks, [2048, 2048, 512])
  receiver.done()
})

test('a restart-required interrupt releases the device before a replacement pipeline starts', async () => {
  let reservations = 0
  const runtime = bindAudioRuntime(
    {
      acquireExclusive() {
        assert.equal(reservations, 0)
        reservations++
        return () => {
          reservations--
        }
      },
    },
    () => makeLease().lease,
  )
  const conversation: Conversation = {
    capabilities: {
      textInput: true,
      imageInput: false,
      interruption: 'local-only',
      historyRepair: 'restart',
      interruptionReuse: 'restart-required',
      inputRoles: ['user'],
      turnControl: 'provider',
      submitCompletion: 'unavailable',
    },
    audio: { input: [mono(16000)], output: [mono(24000)], duplex: 'half' },
    async open() {
      return {
        id: 'backend',
        async submit() {
          return { completion: 'unavailable' as const }
        },
        async setInputEnabled() {},
        async interrupt() {
          return { playback: [], remote: 'unknown', history: 'restart-required' }
        },
        async close() {
          return { reason: 'aborted', remoteFinalization: 'unknown' }
        },
      }
    },
  }
  const options = { microphone: runtime.microphone, speaker: runtime.speaker, conversation, mediaBudget: budget }
  const first = createConversationPipeline(options)
  await first.start()
  assert.equal((await first.interrupt()).history, 'restart-required')
  assert.equal(reservations, 0)
  const replacement = createConversationPipeline(options)
  await replacement.start()
  assert.equal(reservations, 1)
  await replacement.close({ mode: 'abort' })
})

test('closing while a native lease is opening waits for its release exactly once', async () => {
  const device = makeLease(),
    acquired = deferred<DuplexLease>(),
    started = deferred<void>()
  let releases = 0,
    opens = 0
  const runtime = bindAudioRuntime(
    {
      acquireExclusive: () => () => {
        releases++
      },
    },
    () => {
      started.resolve()
      return acquired.promise
    },
  )
  const conversation: Conversation = {
    capabilities: {
      textInput: true,
      imageInput: false,
      interruption: 'local-only',
      historyRepair: 'restart',
      interruptionReuse: 'restart-required',
      inputRoles: ['user'],
      turnControl: 'provider',
      submitCompletion: 'unavailable',
    },
    audio: { input: [mono(16000)], output: [mono(24000)], duplex: 'half' },
    async open() {
      opens++
      throw new Error('unexpected')
    },
  }
  const pipeline = createConversationPipeline({
    microphone: runtime.microphone,
    speaker: runtime.speaker,
    conversation,
    mediaBudget: budget,
  })
  const opening = pipeline.start()
  await started.promise
  const aborted = assert.rejects(opening)
  const closing = pipeline.close({ mode: 'abort' })
  assert.equal(releases, 0)
  acquired.resolve(device.lease)
  await aborted
  await closing
  await pipeline.close({ mode: 'drain' })
  assert.deepEqual([opens, device.closes(), releases], [0, 1, 1])
})

test('interrupt releases audio independently of a hung agent and requires a restart', async () => {
  timer.reset()
  const device = makeLease(),
    hung = deferred<AgentResult>(),
    running = deferred<void>(),
    talk = createPushToTalk()
  const events: ConversationEvent[] = []
  const agent: Agent = {
    run() {
      running.resolve()
      return hung.promise
    },
  }
  const model = createCascadedConversation({
    agent,
    turnDetector: talk.detector,
    voice: '',
    stt: {
      async open() {
        throw Error('unused')
      },
    },
    tts: {
      capabilities: { input: 'segmented', output: 'streaming' },
      async open() {
        throw Error('unused')
      },
    },
  })
  const scope = createVoiceScope()
  const session = await model.open({
    ...scope,
    media: device.lease,
    history: [],
    onEvent: (event) => events.push(event),
  })
  const submitted = await session.submit(
    { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
    scope,
  )
  if (submitted.completion !== 'playback') throw new Error('missing completion')
  await running.promise
  const interrupted = session.interrupt()
  timer.advance(500)
  assert.equal((await interrupted).history, 'restart-required')
  assert.deepEqual(await submitted.done, { turnId: submitted.id, status: 'interrupted' })
  await assert.rejects(
    session.submit({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'again' }] }, scope),
    { code: 'provider_failed' },
  )
  assert.deepEqual(
    events.filter((event) => event.type === 'error'),
    [],
  )
  const last = events.at(-1)
  assert.ok(last?.type === 'turn.ended' && last.status === 'interrupted')
  assert.equal((await session.close({ mode: 'abort' })).remoteFinalization, 'unknown')
  hung.resolve({ status: 'cancelled', error: { code: 'cancelled', message: '' }, appended: [] })
  await tick()
})

test('a slow PCM consumer is cancelled while a synchronous sibling continues receiving samples', async () => {
  const source = createPcmSource(mono(16000)),
    slow = deferred<void>(),
    scope = createVoiceScope(),
    seen: number[] = []
  const first = await pcmMedia.connect(
    source.output,
    createPcmSink(mono(16000), () => slow.promise),
    { ...scope, budget },
  )
  const second = await pcmMedia.connect(
    source.output,
    createPcmSink(mono(16000), (b) => {
      seen.push(b[0])
    }),
    { ...scope, budget },
  )
  const writing = source.push(Uint8Array.of(1, 0))
  const failed = assert.rejects(first.done, /PCM consumer/)
  assert.throws(() => source.offer(Uint8Array.of(2, 0)), /PCM consumer/)
  await failed
  slow.resolve()
  await writing
  source.end()
  await second.done
  assert.deepEqual(seen, [1, 2])
})
