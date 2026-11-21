import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
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
  hasDetector = true,
  apiKey = 'test-only',
  pendingNetwork,
  pendingDetectorClaim,
  lostRelease = false,
  uiPerformance = false,
  pendingConversationClose,
} = {}) {
  const events = [],
    buttons = new Map(),
    states = new Map(),
    balloons = []
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
    ['mod/config', { openaiLive: { apiKey } }],
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
  if (uiPerformance)
    modules.set('stackchan/realtime-ui-performance', {
      acquire() {
        events.push('UI scheduler acquired')
        return () => events.push('UI scheduler released')
      },
    })
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
        async close() {
          if (pendingConversationClose) await pendingConversationClose
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
    fire: (name) => buttons.get(names[name]).callback(),
    wake: () => read(new Uint8Array([1, 0])),
    fault: () => readError(new Error('detector fault')),
    remoteClose: () => conversation.onStateChanged('closed'),
    remoteError: () => conversation.onError(new Error('transport error')),
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

test('session UI scheduling spans active audio and is released after each kind of close', async () => {
  for (const close of ['shutdown', 'remoteClose', 'remoteError']) {
    let finish
    const f = await fixture({
      uiPerformance: true,
      pendingConversationClose: new Promise((resolve) => {
        finish = resolve
      }),
    })
    assert.deepEqual(f.events, [])
    f.fire('session')
    await settle()
    assert.deepEqual(f.events, ['conversation created', 'conversation started', 'UI scheduler acquired'])
    const closing = f[close]()
    await settle()
    assert.equal(f.events.at(-1), 'UI scheduler acquired')
    finish()
    await closing
    await settle()
    assert.deepEqual(f.events.slice(-2), ['conversation released', 'UI scheduler released'])
    await f.shutdown()
  }
})
