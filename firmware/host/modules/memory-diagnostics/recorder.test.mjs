import assert from 'node:assert/strict'
import test from 'node:test'
import { LiveSession } from '../../../mods/examples/openai_live_webrtc/session.js'
import { createMemoryRecorder, measuredSession } from './recorder.js'

function fixture(overrides = {}) {
  const records = [],
    timers = new Map(),
    order = []
  const heap = { uptimeMs: 100, internal: { freeBytes: 200, minFreeBytes: 100, largestFreeBytes: 80 } }
  const recorder = createMemoryRecorder({
    snapshot() {
      order.push('snapshot')
      return heap
    },
    write(line) {
      order.push('write')
      assert.ok(line.endsWith('\n'))
      records.push(JSON.parse(line.slice('[memory] '.length)))
    },
    schedule(callback, delay) {
      const token = {}
      timers.set(token, { callback, delay })
      return token
    },
    cancel: (token) => timers.delete(token),
    runId: 'unit-test',
    ...overrides,
  })
  return {
    recorder,
    records,
    timers,
    order,
    heap,
    fire(delay) {
      const entry = [...timers.entries()].find(([, timer]) => timer.delay === delay)
      assert.ok(entry, `missing ${delay}ms checkpoint`)
      timers.delete(entry[0])
      entry[1].callback()
    },
  }
}

test('idle recorder allocates no timer or sample; explicit snapshots precede output and retain byte fields', () => {
  const f = fixture()
  assert.equal(f.records.length, 0)
  assert.equal(f.timers.size, 0)
  f.recorder.checkpoint('idle-unused')
  assert.deepEqual(f.order, ['snapshot', 'write'])
  assert.deepEqual(f.records[0], {
    schema: 1,
    runId: 'unit-test',
    sequence: 1,
    cycle: 0,
    state: 'idle',
    phase: 'idle-unused',
    heap: f.heap,
    status: 'sample',
  })
  assert.equal(f.timers.size, 0)
})

test('cycles share phases, take only bounded one-shots, and never label connection readiness as duplex', () => {
  const f = fixture()
  for (let cycle = 1; cycle <= 2; cycle++) {
    f.recorder.observe('connecting')
    assert.equal(f.timers.size, 1)
    f.fire(1000)
    assert.equal(f.timers.size, 0)
    f.recorder.observe('connected')
    f.fire(5000)
    f.recorder.checkpoint('duplex')
    f.recorder.observe('closing')
    f.recorder.observe('idle')
    f.fire(5000)
    assert.deepEqual(
      f.records.filter((r) => r.cycle === cycle).map((r) => r.phase),
      ['before-connect', 'connecting-1s', 'connected', 'connected-5s', 'duplex', 'before-close', 'closed', 'closed-5s'],
    )
    assert.equal(f.timers.size, 0)
  }
  assert.deepEqual(
    f.records.map((r) => r.sequence),
    f.records.map((_, i) => i + 1),
  )
})

test('close, failure, reconnect and disposal suppress stale delayed callbacks', () => {
  const f = fixture()
  f.recorder.observe('connecting')
  const staleNegotiation = [...f.timers.values()][0].callback
  f.recorder.observe('closing')
  f.recorder.observe('idle')
  const staleClose = [...f.timers.values()][0].callback
  f.recorder.observe('connecting')
  const count = f.records.length
  staleNegotiation()
  staleClose()
  assert.equal(f.records.length, count)
  assert.equal(f.timers.size, 1)
  f.recorder.observe('error')
  assert.equal(f.timers.size, 0)
  assert.equal(f.records.at(-1).phase, 'error')
  f.recorder.observe('connecting')
  const staleDisposed = [...f.timers.values()][0].callback
  f.recorder.dispose()
  staleDisposed()
  assert.equal(f.timers.size, 0)
  assert.equal(f.records.at(-1).phase, 'before-connect')
})

test('snapshot failure is unavailable evidence; logging failure cannot escape to the caller', () => {
  const f = fixture({
    snapshot: () => {
      throw new Error('private details')
    },
  })
  f.recorder.checkpoint('idle-unused')
  assert.equal(f.records[0].status, 'unavailable')
  assert.equal(f.records[0].heap, undefined)
  assert.ok(!JSON.stringify(f.records).includes('private details'))
  const broken = fixture({
    write: () => {
      throw new Error('logger failed')
    },
  })
  assert.doesNotThrow(() => broken.recorder.observe('closing'))
})

test('actual LiveSession snapshots after awaited native close and host audio/radio release, including reconnect', async () => {
  const f = fixture(),
    events = []
  let finishClose
  class Conversation {
    setVolume() {}
    async connect() {}
    async close() {
      await new Promise((resolve) => {
        finishClose = resolve
      })
      events.push('native-closed')
      return { finalized: true }
    }
  }
  const Measured = measuredSession(LiveSession, {
    observe(state) {
      events.push(state)
      f.recorder.observe(state)
    },
  })
  const session = new Measured({
    Conversation,
    audio: { acquireExclusive: () => () => events.push('audio-released') },
    networkReady: Promise.resolve({ status: 'connected' }),
    acquireLowLatency: () => ({ close: () => events.push('radio-released') }),
    amp: {
      set sampleRate(value) {
        events.push(`amp-${value}`)
      },
    },
    settings: { apiKey: 'test-only' },
    onState: (state) => events.push(`callback-${state}`),
  })
  for (let cycle = 1; cycle <= 2; cycle++) {
    assert.equal(await session.start(), true)
    const closing = session.stop()
    assert.equal(f.records.at(-1).phase, 'before-close')
    finishClose()
    await closing
    assert.equal(f.records.at(-1).phase, 'closed')
    assert.equal(f.records.at(-1).cycle, cycle)
    assert.deepEqual(events.slice(-6), [
      'native-closed',
      'amp-24000',
      'radio-released',
      'audio-released',
      'idle',
      'callback-idle',
    ])
  }
  f.recorder.dispose()
})

test('diagnostic timer failure cannot suppress LiveSession callbacks', () => {
  class Base {
    constructor(options) {
      this.options = options
    }
  }
  const states = [],
    Measured = measuredSession(Base, {
      observe: () => {
        throw new Error('timer unavailable')
      },
    }),
    session = new Measured({ onState: (state) => states.push(state) })
  session.options.onState('idle')
  assert.deepEqual(states, ['idle'])
})
