import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { Emotion } from '../../../host/modules/ui/state/face-state.ts'
import { createWakeConversation } from '../../../host/modules/voice/wake-conversation.ts'

const scopeKey = '__openaiLiveWakeFixture'
const fromFixture = (source) => `data:text/javascript,${encodeURIComponent(source.replaceAll('FIXTURE', scopeKey))}`
const exportsBySpecifier = new Map([
  [
    'modules',
    fromFixture(
      'export default { has: (name) => globalThis.FIXTURE.modules.has(name), importNow: (name) => globalThis.FIXTURE.modules.get(name) }',
    ),
  ],
  ['timer', fromFixture('export default {}')],
  [
    'stackchan/voice',
    fromFixture(
      'export const VoiceScope = { create: () => ({ signal: {}, abort() {} }) }; export const ConversationPipeline = { create: (options) => globalThis.FIXTURE.createPipeline(options) };',
    ),
  ],
  ['face-state', new URL('../../../host/modules/ui/state/face-state.ts', import.meta.url).href],
  ['stackchan-util', fromFixture('export const wait = (ms) => globalThis.FIXTURE.wait(ms)')],
  ['openai-live-decisions-reactions', new URL('./decisions-reactions.js', import.meta.url).href],
  ['openai-live-session', new URL('./session.js', import.meta.url).href],
  ['openai-live-wake-audio', new URL('./wake-audio.js', import.meta.url).href],
])
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(exportsBySpecifier.get(specifier) ?? specifier, context)
  },
})
test.after(() => hook.deregister())

const names = { wake: 'openai-live:wake', session: 'openai-live:session', mute: 'openai-live:mute' }
const settle = () => new Promise((resolve) => setImmediate(resolve))
let nextId = 0
async function fixture({
  decisionsReactions = false,
  wait = () => Promise.resolve(),
  hasDetector = true,
  apiKey = 'test-only',
  pendingNetwork,
  pendingDetectorClaim,
  lostRelease = false,
} = {}) {
  const events = [],
    buttons = new Map(),
    states = new Map(),
    balloons = [],
    emotions = [],
    motion = []
  const format = { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1 }
  let owner, read, readError, conversation
  const modules = new Map([
    [
      'realtimeConversation',
      {
        LiveConversation: {
          create(options) {
            conversation = options
            return options
          },
        },
      },
    ],
    [
      'network-power',
      {
        acquireLowLatency() {
          return { close() {} }
        },
      },
    ],
    ['mod/config', { openaiLive: { apiKey, decisionsReactions } }],
    ['stackchan/voice/wake-conversation', { createWakeConversation }],
    [
      'stackchan/voice/media',
      {
        readSource(input, consumer, onError) {
          assert.equal(input.format, format)
          read = consumer
          readError = onError
          return {
            close() {
              events.push('detached')
            },
          }
        },
      },
    ],
  ])
  if (hasDetector)
    modules.set('wakeword-wakenet', {
      default: class {
        start() {
          events.push('detector start')
        }
        detect(bytes) {
          return bytes[0] === 1
        }
        close() {
          events.push('detector close')
        }
      },
    })
  const runtime = {
    async acquire() {
      if (pendingDetectorClaim) await pendingDetectorClaim
      assert.equal(owner, undefined, 'detector must receive exclusive ownership')
      owner = 'detector'
      events.push('waiting audio')
      return {
        input: { format },
        close() {
          assert.equal(owner, 'detector')
          if (lostRelease) throw new Error('unconfirmed native release')
          owner = undefined
          events.push('waiting released')
        },
      }
    },
  }
  globalThis[scopeKey] = {
    modules,
    wait,
    createPipeline(options) {
      assert.equal(owner, undefined, 'local detector must release before conversation dispatch')
      assert.deepEqual(Object.keys(options).sort(), ['conversation', 'mediaBudget', 'microphone', 'speaker'])
      events.push('conversation created')
      return {
        setVolume() {},
        start() {
          owner = 'conversation'
          events.push('conversation started')
        },
        close() {
          owner = undefined
          events.push('conversation released')
          return { remoteFinalization: 'confirmed' }
        },
      }
    },
  }
  globalThis.amp = Object.create(null)
  globalThis.trace = () => {}
  const mod = await import(`./mod.js?test=${++nextId}`)
  mod.onContextCreated({
    face: { setEmotion: (emotion) => emotions.push(emotion) },
    motion: {
      pose: { body: { position: { x: 0, y: 0, z: 0 }, rotation: { y: 0, p: 0, r: 0 } } },
      async withTemporaryTorque(move) {
        motion.push('torque on')
        try {
          await move((pose) => motion.push(pose))
        } finally {
          motion.push('torque off')
        }
      },
    },
    audio: { microphone: { runtime }, speaker: { runtime } },
    connectivity: { network: { ready: pendingNetwork ?? Promise.resolve({ status: 'connected' }) } },
    ui: {
      drawer: {
        addDrawerButton(button) {
          buttons.set(button.key, button)
          states.set(button.key, button.initialState)
        },
        setDrawerButtonState(key, value) {
          states.set(key, value)
        },
      },
      showBalloon(text) {
        balloons.push(text)
      },
    },
  })
  return {
    events,
    states,
    buttons,
    balloons,
    emotions,
    motion,
    conversation: () => conversation,
    fire: (name) => buttons.get(names[name]).callback(),
    wake: () => read(new Uint8Array([1, 0])),
    fault: () => readError(new Error('detector fault')),
    remoteClose: () => conversation.onStateChanged('closed'),
    shutdown: () => mod.onClose(),
  }
}

test('exact MOD waits for opt-in and releases listening before existing conversation can start', async () => {
  const f = await fixture()
  assert.deepEqual(f.events, [])
  assert.equal(f.states.get(names.wake), false)
  f.fire('wake')
  await settle()
  assert.deepEqual(f.events, ['waiting audio', 'detector start'])
  f.wake()
  await settle()
  assert.deepEqual(f.events, [
    'waiting audio',
    'detector start',
    'detached',
    'detector close',
    'waiting released',
    'conversation created',
    'conversation started',
  ])
  assert.equal(f.balloons.at(-1), '話しかけてください')
  f.fire('session')
  await settle()
  assert.equal(f.states.get(names.wake), false)
  assert.equal(f.events.at(-1), 'conversation released')
  await f.shutdown()
})

test('natural acknowledged conversation end rearms; explicit waiting mute clears local owner', async () => {
  const f = await fixture()
  f.fire('wake')
  await settle()
  f.fire('session')
  await settle()
  f.remoteClose()
  await settle()
  assert.deepEqual(f.events.slice(-3), ['conversation released', 'waiting audio', 'detector start'])
  f.fire('mute')
  await settle()
  assert.equal(f.states.get(names.wake), false)
  assert.equal(f.events.at(-1), 'waiting released')
  await f.shutdown()
})

test('unsupported host and missing safe configuration do not get a wake toggle', async () => {
  for (const options of [{ hasDetector: false }, { apiKey: '' }]) {
    const f = await fixture(options)
    assert.ok(!f.buttons.has(names.wake))
    assert.ok(f.buttons.has(names.session))
    f.fire('session')
    await settle()
    if (options.apiKey === '') assert.deepEqual(f.events, [])
    else assert.equal(f.events.at(-1), 'conversation started')
    await f.shutdown()
  }
})

test('wake-initiated pending network can be stopped without waiting or reconnecting later', async () => {
  let connect
  const f = await fixture({
    pendingNetwork: new Promise((resolve) => {
      connect = resolve
    }),
  })
  f.fire('wake')
  await settle()
  f.wake()
  await settle()
  assert.equal(f.events.at(-1), 'waiting released')
  f.fire('session')
  await settle()
  connect({ status: 'connected' })
  await settle()
  assert.equal(f.states.get(names.wake), false)
  assert.ok(!f.events.includes('conversation created'))
  await f.shutdown()
})

const inputTranscript = 'session.input_transcript.delta'
const outputTranscript = 'session.output_transcript.delta'

function transcript(conversation, type, id, end) {
  conversation.onEvent({ type, event_id: id, delta: 'test', start_ms: end - 100, end_ms: end })
}

function decision(conversation, type, id, { expression, gesture, delegation = null }) {
  const answers = [
    { type: 'choice', name: 'expression', choice: expression },
    { type: 'choice', name: 'gesture', choice: gesture },
  ]
  conversation.onEvent({
    type: 'decision.event',
    delegation_id: delegation,
    trigger_id: 'trigger',
    source_event_type: type,
    source_event_id: id,
    event: { type: 'decision.completed', decision: { answers } },
  })
}

test('Decisions opt-in adds transcript triggers alongside Responses delegation', async () => {
  for (const decisionsReactions of [false, true]) {
    const f = await fixture({ decisionsReactions })
    f.fire('session')
    await settle()
    const conversation = f.conversation()
    assert.equal(conversation.delegation.kind, 'hosted')
    assert.equal(conversation.delegation.model, 'gpt-6-luna')
    if (decisionsReactions)
      assert.deepEqual(
        conversation.triggers.map(({ type, event_type }) => [type, event_type]),
        [
          ['decisions', inputTranscript],
          ['decisions', outputTranscript],
        ],
      )
    else {
      assert.equal(conversation.triggers, undefined)
      assert.equal(conversation.onEvent, undefined)
    }
    await f.shutdown()
  }
})

test('reactions use matched Decisions results and ignore stale, duplicate and closed-session events', async () => {
  const f = await fixture({ decisionsReactions: true })
  f.fire('session')
  await settle()
  const conversation = f.conversation()
  transcript(conversation, inputTranscript, 'recent', 400)
  transcript(conversation, inputTranscript, 'older', 200)
  decision(conversation, outputTranscript, 'recent', { expression: 'sad' })
  decision(conversation, inputTranscript, 'unknown', { expression: 'sad' })
  decision(conversation, inputTranscript, 'recent', { expression: 'sad', delegation: 'other' })
  decision(conversation, inputTranscript, 'recent', { expression: 'constructor', gesture: 'shake' })
  assert.deepEqual(f.emotions, [])
  decision(conversation, inputTranscript, 'recent', { expression: 'happy' })
  decision(conversation, inputTranscript, 'older', { expression: 'sad', gesture: 'nod' })
  decision(conversation, inputTranscript, 'recent', { expression: 'sad', gesture: 'nod' })
  assert.deepEqual(f.emotions, [Emotion.HAPPY])
  assert.deepEqual(f.motion, [])
  transcript(conversation, outputTranscript, 'reply', 500)
  transcript(conversation, inputTranscript, 'new-input', 520)
  transcript(conversation, outputTranscript, 'next-reply', 540)
  conversation.onEvent(null)
  decision(conversation, inputTranscript, 'new-input', { expression: 'sad' })
  decision(conversation, outputTranscript, 'reply', { expression: 'concerned' })
  assert.deepEqual(f.emotions, [Emotion.HAPPY, Emotion.DOUBTFUL])
  await f.shutdown()
  transcript(conversation, outputTranscript, 'late', 600)
  decision(conversation, outputTranscript, 'late', { expression: 'happy', gesture: 'nod' })
  assert.deepEqual(f.emotions, [Emotion.HAPPY, Emotion.DOUBTFUL, Emotion.NEUTRAL])
  assert.deepEqual(f.motion, [])
})

test('a nod returns to the original pose and releases torque when the session stops', async () => {
  let releaseStep
  const f = await fixture({
    decisionsReactions: true,
    wait: () =>
      releaseStep === undefined
        ? new Promise((resolve) => {
            releaseStep = resolve
          })
        : Promise.resolve(),
  })
  f.fire('session')
  await settle()
  const conversation = f.conversation()
  transcript(conversation, inputTranscript, 'first', 100)
  decision(conversation, inputTranscript, 'first', { gesture: 'nod' })
  await settle()
  assert.equal(f.motion[0], 'torque on')
  assert.equal(f.motion.length, 2)
  assert.ok(f.motion[1].rotation.p > 0)
  transcript(conversation, outputTranscript, 'second', 200)
  decision(conversation, outputTranscript, 'second', { gesture: 'nod' })
  let closed = false
  const closing = f.shutdown().then(() => {
    closed = true
  })
  await settle()
  assert.equal(closed, false)
  assert.equal(f.motion.length, 2)
  releaseStep()
  await closing
  assert.deepEqual(f.motion.slice(2), [
    { position: { x: 0, y: 0, z: 0 }, rotation: { y: 0, p: 0, r: 0 } },
    'torque off',
  ])
})

test('a runtime detector fault disarms, then manual start remains available after positive release', async () => {
  const f = await fixture()
  f.fire('wake')
  await settle()
  f.fault()
  await settle()
  assert.equal(f.states.get(names.wake), false)
  assert.equal(f.events.at(-1), 'waiting released')
  f.fire('session')
  await settle()
  assert.equal(f.events.at(-1), 'conversation started')
  await f.shutdown()
})

test('unconfirmed detector close does not start a replacement even via the manual drawer', async () => {
  const f = await fixture({ lostRelease: true })
  f.fire('wake')
  await settle()
  f.wake()
  await settle()
  assert.equal(f.states.get(names.wake), false)
  assert.equal(f.balloons.at(-1), '音声の解放を確認できません')
  f.fire('session')
  await settle()
  assert.ok(!f.events.includes('conversation created'))
  await f.shutdown()
})

test('late proven no-claim after manual handoff does not leave a stale Wake drawer toggle', async () => {
  let rejectClaim
  const f = await fixture({
    pendingDetectorClaim: new Promise((_resolve, reject) => {
      rejectClaim = reject
    }),
  })
  f.fire('wake')
  await settle()
  assert.equal(f.states.get(names.wake), true)
  f.fire('session')
  rejectClaim(Object.assign(new Error('already owned by host'), { code: 'device_busy' }))
  await settle()
  assert.deepEqual(f.events, ['conversation created', 'conversation started'])
  assert.equal(f.states.get(names.wake), false)
  f.remoteClose()
  await settle()
  assert.equal(f.events.at(-1), 'conversation released')
  assert.equal(f.states.get(names.wake), false)
  await f.shutdown()
})
