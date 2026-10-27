import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { LiveSession } from '../../../../mods/examples/openai_live_webrtc/session.js'
import { MemoryRecorder } from '../../testing/memory/recorder.js'

test('diagnostic MOD keeps ordinary settings and includes each session source under one distinct specifier', () => {
  const directory = new URL('../../../../mods/examples/openai_live_webrtc/', import.meta.url)
  const ordinary = JSON.parse(readFileSync(new URL('manifest.json', directory), 'utf8'))
  const diagnostic = JSON.parse(readFileSync(new URL('manifest.memory.json', directory), 'utf8'))
  assert.deepEqual(diagnostic.config, ordinary.config)
  assert.deepEqual(diagnostic.include, ordinary.include)
  const baseSource = ordinary.modules['openai-live-session']
  const sources = Object.values(diagnostic.modules).flat()
  assert.equal(sources.filter((source) => source === baseSource).length, 1)
  assert.equal(diagnostic.modules['openai-live-session-base'], baseSource)
  assert.notEqual(diagnostic.modules['openai-live-session'], baseSource)
  assert.deepEqual(diagnostic.modules['*'], ordinary.modules['*'])
})

function fixture() {
  let now = 0,
    next = 0,
    reads = 0
  const timers = new Map(),
    logs = []
  const memory = { internal: { freeBytes: 123 }, psram: { allocatedBytes: 456 } }
  const recorder = new MemoryRecorder({
    snapshot() {
      reads++
      return { atUs: now * 1000, durationUs: 2, ...memory }
    },
    write: (line) => logs.push(JSON.parse(line.slice('[stackchan-memory] '.length))),
    setTimeout(callback, delay) {
      timers.set(++next, { callback, at: now + delay })
      return next
    },
    clearTimeout: (id) => timers.delete(id),
  })
  return {
    recorder,
    logs,
    timers,
    get reads() {
      return reads
    },
    advance(ms) {
      now += ms
      for (const [id, timer] of timers) {
        if (timer.at > now) continue
        timers.delete(id)
        timer.callback()
      }
    },
  }
}

test('memory observations are bounded, labelled by cycle, and never poll', () => {
  const f = fixture()
  f.advance(60000)
  assert.equal(f.reads, 0)
  f.recorder.sample('idle-before-use')
  f.recorder.onState('connecting')
  f.recorder.onNegotiating()
  f.advance(249)
  assert.equal(f.logs.at(-1).phase, 'negotiating')
  f.advance(1)
  assert.equal(f.logs.at(-1).phase, 'connecting')
  f.recorder.onState('connected')
  f.advance(5000)
  assert.equal(f.logs.at(-1).phase, 'duplex')
  f.advance(60000)
  assert.equal(f.timers.size, 0)
  assert.equal(f.reads, 6)
  f.recorder.onState('closing')
  f.recorder.onState('idle')
  f.advance(1000)
  assert.equal(f.logs.at(-1).phase, 'settled')
  f.recorder.onState('connecting')
  assert.equal(f.logs.at(-1).cycle, 2)
  assert.deepEqual(
    f.logs.map((v) => v.sequence),
    f.logs.map((_, i) => i + 1),
  )
  assert.ok(f.logs.every((v) => v.schema === 1 && v.internal.freeBytes === 123 && v.psram.allocatedBytes === 456))
})

test('fast transitions cancel stale negotiation, duplex and post-close observations', () => {
  const f = fixture()
  for (const state of ['connecting', 'connected', 'closing', 'idle', 'connecting']) {
    f.recorder.onState(state)
    if (state === 'connecting') f.recorder.onNegotiating()
  }
  f.advance(1000)
  assert.deepEqual(
    f.logs.map((v) => v.phase),
    [
      'before-connect',
      'negotiating',
      'connected',
      'before-close',
      'after-close',
      'before-connect',
      'negotiating',
      'connecting',
    ],
  )
  assert.equal(f.logs.at(-1).cycle, 2)
  assert.equal(f.logs.at(-1).state, 'connecting')
})

test('after-close observation follows actual awaited native close, amplifier and lease cleanup', async () => {
  const f = fixture(),
    events = []
  let closed
  const close = new Promise((resolve) => {
    closed = resolve
  })
  const session = new LiveSession({
    Conversation: class {
      setVolume() {}
      connect() {
        return Promise.resolve()
      }
      close() {
        events.push('close')
        return close
      }
    },
    audio: { acquireExclusive: () => () => events.push('release-audio') },
    acquireLowLatency: () => ({ close: () => events.push('release-radio') }),
    amp: {
      set sampleRate(rate) {
        events.push(rate)
      },
    },
    networkReady: Promise.resolve({ status: 'connected' }),
    settings: { apiKey: 'test-placeholder' },
    onState(state) {
      events.push(state)
      f.recorder.onState(state)
    },
  })
  await session.start()
  const stopping = session.stop()
  assert.equal(f.logs.at(-1).phase, 'before-close')
  f.advance(6000)
  assert.equal(f.logs.at(-1).phase, 'before-close')
  closed({ finalized: true })
  await stopping
  assert.deepEqual(events.slice(-4), [24000, 'release-radio', 'release-audio', 'idle'])
  assert.equal(f.logs.at(-1).phase, 'after-close')
  f.advance(1000)
  assert.equal(f.logs.at(-1).phase, 'settled')
})

test('failure results remain visible and diagnostic exceptions do not escape', () => {
  const f = fixture()
  for (const state of ['connecting', 'closing', 'error']) f.recorder.onState(state)
  f.advance(1000)
  assert.equal(f.logs.at(-1).state, 'error')
  assert.equal(f.logs.at(-1).phase, 'settled')
  f.recorder.snapshot = () => {
    throw new Error('unavailable')
  }
  assert.doesNotThrow(() => f.recorder.onState('connecting'))
  f.recorder.onNegotiating()
  const count = f.logs.length
  f.advance(250)
  assert.equal(f.logs.length, count)
  f.recorder.snapshot = () => ({})
  f.recorder.write = () => {
    throw new Error('logging failed')
  }
  assert.doesNotThrow(() => f.recorder.onState('closing'))
  f.recorder.setTimeout = f.recorder.clearTimeout = () => {
    throw new Error('timer allocation/cleanup failed')
  }
  assert.doesNotThrow(() => f.recorder.onState('idle'))
  assert.doesNotThrow(() => f.recorder.onState('connecting'))
  assert.doesNotThrow(() => f.recorder.onNegotiating())
})

test('a callback whose timer could not be cleared cannot log under a later cycle', () => {
  const f = fixture()
  f.recorder.clearTimeout = () => {
    throw new Error('clear failed')
  }
  f.recorder.onState('connecting')
  f.recorder.onNegotiating()
  f.recorder.onState('closing')
  f.recorder.onState('idle')
  f.recorder.onState('connecting')
  f.advance(1000)
  assert.equal(f.logs.at(-1).phase, 'before-connect')
  assert.equal(f.logs.at(-1).cycle, 2)
})

test('diagnostic session adapter observes native start after network readiness and records actual cleanup', () => {
  const script = fileURLToPath(new URL('../../testing/memory/__tests__/adapter.mjs', import.meta.url))
  const run = spawnSync(process.execPath, ['--experimental-vm-modules', script], { encoding: 'utf8', timeout: 5000 })
  assert.ifError(run.error)
  assert.equal(run.status, 0, run.stdout + run.stderr)
})

test('native snapshot reads both capability pools before XS allocation, preserves minima, and handles absent PSRAM', {
  skip: process.platform === 'win32' ? 'requires a POSIX C11 compiler' : false,
}, () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'stackchan-memory-'))
  const here = path.dirname(fileURLToPath(import.meta.url))
  const directory = path.resolve(here, '../../testing/memory')
  const executable = path.join(temporary, 'snapshot')
  try {
    const compiled = spawnSync(
      process.env.CC ?? 'cc',
      [
        '-std=c11',
        '-Wall',
        '-Wextra',
        '-Werror',
        '-I',
        path.join(directory, '__tests__/include'),
        path.join(directory, 'snapshot.c'),
        path.join(directory, '__tests__/main.c'),
        '-o',
        executable,
      ],
      { encoding: 'utf8' },
    )
    assert.ifError(compiled.error)
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr)
    const run = spawnSync(executable, [], { encoding: 'utf8', timeout: 5000 })
    assert.ifError(run.error)
    assert.equal(run.status, 0, run.stdout + run.stderr)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
})
