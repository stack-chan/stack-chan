import assert from 'node:assert/strict'
import test from 'node:test'
import { PathCheck } from '../controller.js'
import { createRoute } from '../routes.js'

function fixture(extra = {}) {
  const states = [],
    calls = []
  let timer, onEvent
  const pipeline = {
    async start() {
      calls.push('start')
    },
    async close() {
      calls.push('close')
      return { remoteFinalization: 'confirmed' }
    },
  }
  const check = new PathCheck({
    createRoute: () => ({
      conversation: {},
      ptt: { press: () => calls.push('press'), release: () => calls.push('release') },
    }),
    createPipeline: (_, listener) => {
      onEvent = listener
      return pipeline
    },
    networkReady: Promise.resolve({ status: 'connected' }),
    schedule: (fn) => {
      timer = fn
      return 1
    },
    clear: () => calls.push('clear'),
    notify: (state) => states.push(state),
    ...extra,
  })
  return { check, pipeline, states, calls, timeout: () => timer(), event: (value) => onEvent(value) }
}

test('starts only on demand, record/send and stop release resources once', async () => {
  const f = fixture()
  assert.deepEqual(f.calls, [])
  const first = f.check.start()
  assert.equal(f.check.start(), first)
  await first
  f.check.record()
  f.check.record()
  assert.deepEqual(f.calls, ['start', 'press', 'release'])
  await Promise.all([f.check.stop(), f.check.stop()])
  assert.equal(f.calls.filter((x) => x === 'close').length, 1)
  assert.equal(f.check.active, undefined)
})
test('stop while waiting for network never creates a paid session', async () => {
  let ready
  const f = fixture({
    networkReady: new Promise((resolve) => {
      ready = resolve
    }),
  })
  const pending = f.check.start()
  await f.check.stop()
  ready({ status: 'connected' })
  await pending
  assert.ok(!f.calls.includes('start'))
})
test('deadline and fatal events close the session', async () => {
  for (const trigger of [(f) => f.timeout(), (f) => f.event({ type: 'error', fatal: true })]) {
    const f = fixture()
    await f.check.start()
    trigger(f)
    await f.check.stop()
    assert.ok(f.calls.includes('close'))
  }
})
test('failed start is cleaned up without leaking exception text', async () => {
  const f = fixture()
  f.pipeline.start = async () => {
    throw new Error('secret provider response')
  }
  await f.check.start()
  assert.ok(f.calls.includes('close'))
  assert.ok(!f.states.join().includes('secret'))
})
test('unknown remote finalization is visible rather than claimed successful', async () => {
  const f = fixture()
  f.pipeline.close = async () => ({ remoteFinalization: 'unknown' })
  await f.check.start()
  await f.check.stop()
  assert.ok(f.states.includes('closed: remote state unknown'))
})

function modules() {
  const create = (kind) => ({ create: (options) => ({ kind, options }) })
  return {
    'stackchan/voice': { CascadedConversation: create('cascade'), PushToTalk: { create: () => ({ detector: 'ptt' }) } },
    'stackchan/ai': {
      Agent: create('agent'),
      OpenAIResponsesLLM: create('responses'),
      ChatCompletionsLLM: create('chat'),
      ToolSet: create('tools'),
      asDelegateAgent: (agent) => ({ agent }),
    },
    'stackchan/voice/speech': { WhisperSTT: create('stt'), OpenAISpeechTTS: create('tts') },
    realtimeConversation: { LiveConversation: create('live') },
    chat: { ChatConversation: create('ws'), XiaoZhiV1Connection: create('xiaozhi') },
  }
}
const configured = {
  llm: { apiKey: 'test-placeholder', model: 'test-model' },
  speech: { apiKey: 'test-placeholder' },
  live: { apiKey: 'test-placeholder', model: 'test-live' },
}
test('cascade explicitly constructs STT, agent and TTS independent of saved host config', () => {
  const libs = modules()
  const result = createRoute({ ...configured, route: 'cascade' }, (name) => libs[name])
  assert.equal(result.conversation.options.agent.options.llm.kind, 'responses')
  assert.equal(result.conversation.options.turnDetector, 'ptt')
  assert.equal(result.conversation.options.tts.kind, 'tts')
})
test('WebRTC supports none, hosted and actual client agent delegation', () => {
  for (const delegation of ['none', 'hosted', 'client']) {
    const libs = modules()
    const result = createRoute({ ...configured, route: 'webrtc', delegation }, (name) => libs[name])
    assert.equal(result.conversation.options.delegation.kind, delegation)
    if (delegation === 'client') assert.equal(result.conversation.options.delegation.delegate.agent.kind, 'agent')
  }
})
test('WebSocket and XiaoZhi use their public connection factories', () => {
  const libs = modules()
  assert.equal(
    createRoute(
      { route: 'websocket', chat: { type: 'openAIRealtime', apiKey: 'test-placeholder' } },
      (name) => libs[name],
    ).conversation.options.config.type,
    'openAIRealtime',
  )
  assert.equal(
    createRoute({ route: 'xiaozhi', xiaozhi: { endpoint: 'wss://example.invalid' } }, (name) => libs[name]).conversation
      .options.connection.kind,
    'xiaozhi',
  )
})
test('missing config fails before provider construction', () => {
  for (const route of ['cascade', 'webrtc', 'websocket', 'invalid']) {
    const libs = modules()
    assert.throws(() => createRoute({ route }, (name) => libs[name]))
  }
})
test('record is ignored until connection has started', async () => {
  let ready
  const f = fixture({
    networkReady: new Promise((resolve) => {
      ready = resolve
    }),
  })
  const pending = f.check.start()
  f.check.record()
  assert.ok(!f.calls.includes('press'))
  ready({ status: 'connected' })
  await pending
  f.check.record()
  assert.ok(f.calls.includes('press'))
  await f.check.stop()
})
test('invalid and oversized durations retain a bounded deadline', () => {
  assert.equal(fixture({ maxMs: Number.NaN }).check.maxMs, 90000)
  assert.equal(fixture({ maxMs: 900000 }).check.maxMs, 300000)
})
