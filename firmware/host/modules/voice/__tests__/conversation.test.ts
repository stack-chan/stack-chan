import assert from 'node:assert/strict'
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
  assert.deepEqual([...output.buffers[0]], [1, 2])
  let thirdAccepted = false
  const third = writeSink(writer, packet).then(() => {
    thirdAccepted = true
  })
  await tick()
  assert.equal(thirdAccepted, false)
  output.callback(1)
  await third
  const pending = lease.output.finish('one')
  const [cut] = await lease.output.fence(1)
  assert.deepEqual(await pending, cut)
  assert.deepEqual(cut.position, { basis: 'estimate', sampleRate: 24000, renderedFrames: 1 })
  assert.equal(inputs, 1)
  assert.ok(output.closed)
  await assert.rejects(writeSink(writer, packet))
  await lease.close()
  assert.deepEqual([inputs, reserved], [0, false])
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
    async open({ format }) {
      const source = createPcmSource(format)
      return {
        output: source.output,
        async write(text) {
          assert.equal(text, 'はい。')
          await source.push(Uint8Array.of(4, 5))
        },
        async finish() {
          source.end()
        },
        textAt() {
          return { text: '', basis: 'unknown' }
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
    async open({ format }) {
      const source = createPcmSource(format)
      return {
        output: source.output,
        async write(s) {
          speaking.push(s)
          await source.push(Uint8Array.of(0, 0))
        },
        async finish() {
          source.end()
        },
        async close() {},
        textAt() {
          return { text: '', basis: 'unknown' }
        },
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
    capabilities: { textInput: true, imageInput: false, interruption: 'local-only', historyRepair: 'restart' },
    audio: { input: [mono(16000)], output: [mono(24000)], duplex: 'half' },
    async open() {
      return {
        id: 'backend',
        async submit() {},
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
    capabilities: { textInput: true, imageInput: false, historyRepair: 'restart', interruption: 'local-only' },
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

test('interrupt releases audio independently of a hung agent and forgets tool calls only after retirement', async () => {
  timer.reset()
  const device = makeLease(),
    hung = deferred<AgentResult>(),
    running = deferred<void>(),
    talk = createPushToTalk()
  const forgotten: string[] = []
  const agent: Agent = {
    run() {
      running.resolve()
      return hung.promise
    },
    releaseSession(id) {
      forgotten.push(id)
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
      async open() {
        throw Error('unused')
      },
    },
  })
  const scope = createVoiceScope()
  const session = await model.open({ ...scope, media: device.lease, history: [], onEvent() {} })
  await session.submit({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }, scope)
  await running.promise
  const interrupted = session.interrupt()
  timer.advance(500)
  assert.equal((await interrupted).history, 'restart-required')
  assert.equal((await session.close({ mode: 'abort' })).remoteFinalization, 'unknown')
  assert.deepEqual(forgotten, [])
  hung.resolve({ status: 'cancelled', error: { code: 'cancelled', message: '' }, appended: [] })
  await tick()
  assert.deepEqual(forgotten, [session.id])
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
