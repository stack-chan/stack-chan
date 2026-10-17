import assert from 'node:assert/strict'
import test from 'node:test'
import { LiveSession } from './session.js'

function deferred() {
  let resolve, reject
  const promise = new Promise((a, b) => {
    resolve = a
    reject = b
  })
  return { promise, resolve, reject }
}
function fixture(overrides = {}) {
  const states = [],
    events = [],
    instances = []
  let connecting, closing, mute
  class Conversation {
    constructor(options) {
      this.options = options
      instances.push(this)
    }
    setVolume(value) {
      this.volume = value
    }
    async connect() {
      if (connecting) await connecting.promise
    }
    async close() {
      events.push('native closing')
      if (closing) await closing.promise
      connecting?.reject(new Error('cancelled'))
      events.push('native closed')
      return { finalized: true }
    }
    async setMuted(value) {
      if (mute) await mute.promise
      this.muted = value
    }
  }
  const session = new LiveSession({
    Conversation,
    audio: {
      acquireExclusive() {
        events.push('audio acquired')
        return () => events.push('audio released')
      },
    },
    networkReady: Promise.resolve({ status: 'connected' }),
    acquireLowLatency() {
      events.push('radio acquired')
      return { close: () => events.push('radio released') }
    },
    amp: {
      set sampleRate(value) {
        events.push(`amp ${value}`)
      },
    },
    settings: { apiKey: 'unit-test-only', volume: 0.1, model: 'gpt-live-1', voice: 'marin' },
    onState: (state) => states.push(state),
    ...overrides,
  })
  return {
    session,
    states,
    events,
    instances,
    connectPending() {
      connecting = deferred()
      return connecting
    },
    closePending() {
      closing = deferred()
      return closing
    },
    mutePending() {
      mute = deferred()
      return mute
    },
  }
}

test('empty key and unavailable network never acquire audio or create a session', async () => {
  for (const overrides of [{ settings: { apiKey: '' } }, { networkReady: Promise.resolve({ status: 'skipped' }) }]) {
    const f = fixture(overrides)
    assert.equal(await f.session.start(), false)
    assert.equal(f.instances.length, 0)
    assert.deepEqual(f.events, [])
    assert.equal(f.session.active, undefined)
  }
})
test('start, acknowledged mute and close reuse Conversation and release only after native close', async () => {
  const f = fixture()
  f.session.settings.backendModel = 'test-backend-model'
  assert.equal(await f.session.start(), true)
  assert.equal(f.instances[0].volume, 0.1)
  assert.equal(f.instances[0].options.model, 'gpt-live-1')
  assert.deepEqual(f.instances[0].options.delegation, {
    type: 'responses',
    responses: { model: f.session.settings.backendModel },
  })
  assert.equal(await f.session.setMuted(true), true)
  const closing = f.closePending()
  const stop = f.session.stop()
  assert.equal(stop, f.session.stop())
  assert.equal(f.session.start(), f.session.active.starting)
  assert.ok(!f.events.includes('audio released'))
  closing.resolve()
  await stop
  assert.deepEqual(f.events, [
    'audio acquired',
    'radio acquired',
    'amp 48000',
    'native closing',
    'native closed',
    'amp 24000',
    'radio released',
    'audio released',
  ])
  assert.equal(f.session.active, undefined)
  assert.equal(f.states.at(-1), 'idle')
  assert.equal(await f.session.start(), true)
  assert.equal(f.instances.length, 2)
  await f.session.stop()
})
test('cancellation while Wi-Fi is pending cannot create a paid session after restart', async () => {
  const ready = deferred(),
    f = fixture({ networkReady: ready.promise })
  const old = f.session.start()
  await f.session.stop()
  const current = f.session.start()
  ready.resolve({ status: 'connected' })
  assert.equal(await old, false)
  assert.equal(await current, true)
  assert.equal(f.instances.length, 1)
  await f.session.stop()
})
test('stop during connection waits for native shutdown before a fresh start', async () => {
  const f = fixture(),
    connecting = f.connectPending(),
    closing = f.closePending()
  const start = f.session.start()
  await Promise.resolve()
  const stop = f.session.stop()
  assert.ok(f.session.active)
  assert.ok(!f.events.includes('audio released'))
  closing.resolve()
  await stop
  assert.equal(await start, false)
  connecting.promise.catch(() => {})
  assert.equal(f.session.active, undefined)
})
test('transport errors and remote close release audio/radio and permit manual reconnect', async () => {
  for (const event of ['error', 'closed']) {
    const f = fixture()
    await f.session.start()
    if (event === 'error') f.instances[0].options.onError(new Error('private provider detail'))
    else f.instances[0].options.onStateChanged('closed')
    await f.session.stop()
    assert.equal(f.session.active, undefined)
    assert.equal(f.events.filter((e) => e === 'audio released').length, 1)
    assert.equal(f.states.at(-1), event === 'error' ? 'error' : 'idle')
    await f.session.start()
    await f.session.stop()
  }
})
test('failed radio acquisition and cleanup errors never retain the audio owner', async () => {
  const f = fixture({
    acquireLowLatency() {
      throw new Error('radio')
    },
  })
  assert.equal(await f.session.start(), false)
  assert.deepEqual(f.events, ['audio acquired', 'audio released'])
  assert.equal(f.session.active, undefined)
  const g = fixture({
    amp: {
      set sampleRate(rate) {
        if (rate === 24000) throw new Error('amp')
      },
    },
  })
  await g.session.start()
  await g.session.stop()
  assert.ok(g.events.includes('radio released'))
  assert.ok(g.events.includes('audio released'))
  assert.equal(g.states.at(-1), 'error')
})
test('a late failed mute from a closed session cannot close its replacement', async () => {
  const f = fixture()
  await f.session.start()
  const pending = f.mutePending(),
    muting = f.session.setMuted(true)
  await f.session.stop()
  await f.session.start()
  pending.reject(new Error('old mute timeout'))
  assert.equal(await muting, false)
  assert.equal(f.session.active.conversation, f.instances[1])
  await f.session.stop()
})

test('late error/closed callbacks from an old session cannot stop its replacement', async () => {
  const f = fixture()
  await f.session.start()
  const old = f.instances[0]
  await f.session.stop()
  await f.session.start()
  old.options.onError(new Error('late hangup failure'))
  old.options.onStateChanged('closed')
  assert.equal(f.session.active.conversation, f.instances[1])
  assert.equal(f.states.at(-1), 'connected')
  await f.session.stop()
})
