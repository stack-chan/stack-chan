import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'

const load = {
  'muse-host-session': 'export const createHostMuseConversation = () => ({})',
  'muse-pairing/peripheral': 'export const createPairingPeripheral = () => {}',
  'muse-pairing-native':
    'export default class {}\nexport const AccountSession = {restore: () => globalThis.museFixture.account()}',
  'muse-setup-metadata': 'export default () => globalThis.museFixture.identity',
  'muse-setup/pairing-controller':
    'export const createPairingController = (options) => globalThis.museFixture.pairingController(options)',
  preference: 'export default {get: () => globalThis.museFixture.key}',
  'stackchan/voice/pipeline':
    'export const createConversationPipeline = (options) => globalThis.museFixture.pipeline(options)',
  'stackchan/voice/scope':
    'export const createVoiceScope = () => { const scope = new AbortController(); return Object.assign(scope, {dispose() {}}) }',
  time: 'export default { ticks: 0 }',
}
registerHooks({
  resolve(specifier, context, next) {
    if (load[specifier]) return next(`data:text/javascript,${encodeURIComponent(load[specifier])}`, context)
    return next(specifier, context)
  },
})
globalThis.trace = () => {}
const { createMuseConversationControl } = await import('../host-control.js')

function setup() {
  const states = []
  const gates = []
  const closed = []
  const progress = []
  const pending = Promise.withResolvers()
  let emit
  const fixture = {
    identity: { setupComplete: true, nodeId: 'node' },
    key: 'placeholder',
    account: () => ({
      generation: 1,
      connectApproved: () => pending.promise,
      close() {
        closed.push('account')
        pending.reject(new Error('closed'))
      },
    }),
    pairingController({ coordinator, onChange }) {
      return {
        start() {
          onChange({ phase: 'advertising', name: 'MuseGadget' })
        },
        async confirmPhysical() {
          const account = {
            current: (generation) => generation === 5,
            commitApproved: () => ({ saved: true }),
            connectApproved: () => pending.promise,
            close: () => closed.push('account'),
          }
          coordinator.acceptProvision(account, 5)
          onChange({ phase: 'review', name: 'MuseGadget' })
          return true
        },
        async reportProgress(value) {
          progress.push(value)
          return true
        },
        async close() {
          coordinator.close()
          closed.push('pairing')
        },
      }
    },
    pipeline(options) {
      emit = options.onEvent
      return {
        setVolume(volume) {
          assert.equal(volume, 0.3)
        },
        async start() {
          assert.equal(options.microphoneMuted, true)
        },
        async setMicrophoneMuted(muted) {
          gates.push(muted)
        },
        async close() {
          closed.push('pipeline')
        },
      }
    },
  }
  globalThis.museFixture = fixture
  const control = createMuseConversationControl({
    microphone: {},
    speaker: {},
    volume: 0.3,
    onState(state) {
      states.push(state.phase)
    },
  })
  return {
    control,
    fixture,
    states,
    gates,
    closed,
    progress,
    resolve: () => pending.resolve({ prepared: true }),
    emit: (event) => emit(event),
  }
}

test('after a recoverable TTS failure another press can start a turn in the same call', async () => {
  const f = setup()
  const running = f.control.start()
  f.resolve()
  assert.equal(await running, true)
  assert.equal(await f.control.setTalking(true), true)
  assert.equal(await f.control.setTalking(false), true)
  assert.equal(await f.control.setTalking(true), false)
  f.emit({ type: 'error', code: 'provider_failed', fatal: false })
  assert.equal(await f.control.setTalking(true), true)
  assert.equal(await f.control.setTalking(false), true)
  f.emit({ type: 'output.level', value: 0.2 })
  f.emit({ type: 'turn.ended', status: 'completed' })
  assert.deepEqual(f.gates, [false, true, false, true])
  assert.deepEqual(f.states, [
    'connecting',
    'ready',
    'listening',
    'thinking',
    'ready',
    'listening',
    'thinking',
    'speaking',
    'ready',
  ])
  await f.control.end()
  assert.deepEqual(f.closed, ['pipeline', 'account'])
  assert.equal(f.control.snapshot().phase, 'idle')
})

test('ending before Muse account authentication closes the account and ignores its late result', async () => {
  const f = setup()
  const starting = f.control.start()
  await f.control.end()
  assert.equal(await starting, false)
  assert.deepEqual(f.closed, ['account'])
  assert.equal(f.control.snapshot().phase, 'idle')
})

test('a failed remote turn closes the audio lease and permits a fresh call', async () => {
  const f = setup()
  const starting = f.control.start()
  f.resolve()
  assert.equal(await starting, true)
  f.emit({ type: 'error', code: 'cancelled_unconfirmed', fatal: true })
  await f.control.end()
  assert.deepEqual(f.closed, ['pipeline', 'account'])
  assert.deepEqual(f.control.snapshot(), { phase: 'failed', error: 'cancelled_unconfirmed' })
  assert.equal(await f.control.start(), true)
  await f.control.close()
  assert.deepEqual(f.closed, ['pipeline', 'account', 'pipeline', 'account'])
})

test('Muse pairing reports authentication before closing BLE', async () => {
  const f = setup()
  f.fixture.identity = { setupComplete: false, sdkReady: true }
  assert.equal(await f.control.startPairing(), true)
  assert.equal(await f.control.confirmPairing(), true)
  const saving = f.control.savePairing()
  assert.equal(f.control.snapshot().phase, 'pairing')
  assert.deepEqual(f.progress, ['wifi_connected'])
  assert.deepEqual(f.closed, [])
  f.resolve()
  assert.equal(await saving, true)
  assert.deepEqual(f.progress, ['wifi_connected', 'auth_ok'])
  assert.deepEqual(f.closed, ['account', 'pairing'])
  assert.equal(f.control.snapshot().phase, 'idle')
})
