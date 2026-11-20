import assert from 'node:assert/strict'
import { test } from 'node:test'

import { FirmwareReadiness } from '../src/services/simulator/firmware-readiness.mjs'

function createHarness() {
  const scheduled = new Map()
  const ready = []
  let nextId = 0
  let timeouts = 0
  let failures = 0
  const readiness = new FirmwareReadiness({
    onReady: (installation) => ready.push(installation),
    onTimeout: () => timeouts++,
    onFailure: () => failures++,
    setTimer: (callback, delay) => {
      const id = ++nextId
      scheduled.set(id, { callback, delay })
      return id
    },
    clearTimer: (id) => scheduled.delete(id),
  })
  return {
    readiness,
    ready,
    scheduled,
    get timeouts() { return timeouts },
    get failures() { return failures },
    expire() {
      for (const [id, timer] of [...scheduled]) {
        scheduled.delete(id)
        timer.callback()
      }
    },
  }
}

test('settings and splash do not time out before application boot', () => {
  const harness = createHarness()
  const installation = { status: 'empty' }
  harness.readiness.start(installation)
  harness.readiness.onTrace('[main] start')
  harness.readiness.onTrace('[settings] opened')
  harness.expire()
  assert.equal(harness.timeouts, 0)
  assert.deepEqual(harness.ready, [])

  harness.readiness.onTrace('[main] onLaunch shouldCreateContext=true')
  assert.equal(harness.scheduled.size, 1)
  assert.equal([...harness.scheduled.values()][0].delay, 30_000)
  harness.readiness.onTrace('[main] app behaviors ready')
  assert.deepEqual(harness.ready, [installation])
  assert.equal(harness.scheduled.size, 0)
})

for (const phase of ['initialization', 'launch', 'context']) {
  test(`startup failure during ${phase} settles once and permits a new boot`, () => {
    const harness = createHarness()
    harness.readiness.start({ status: 'prepared' })
    if (phase === 'context') harness.readiness.onTrace('[main] onLaunch shouldCreateContext=true')
    const queuedTimer = [...harness.scheduled.values()][0]

    harness.readiness.onTrace(`[main] startup failed phase=${phase} error=TypeError`)
    harness.readiness.onTrace(`[main] startup failed phase=${phase} error=TypeError`)
    queuedTimer?.callback()
    harness.expire()
    harness.readiness.onTrace('[main] app behaviors ready')
    harness.readiness.onTrace('[main] onLaunch shouldCreateContext=true')
    assert.equal(harness.failures, 1)
    assert.equal(harness.timeouts, 0)
    assert.deepEqual(harness.ready, [])
    assert.equal(harness.scheduled.size, 0)

    const nextInstallation = { status: 'empty' }
    harness.readiness.start(nextInstallation)
    harness.readiness.onTrace('[main] onLaunch shouldCreateContext=true')
    harness.readiness.onTrace('[main] app behaviors ready')
    assert.deepEqual(harness.ready, [nextInstallation])
    assert.equal(harness.scheduled.size, 0)
    assert.equal(harness.failures, 1)
  })
}

test('a stalled boot still times out once and ignores late ready traces', () => {
  const harness = createHarness()
  harness.readiness.start({ status: 'prepared' })
  harness.readiness.onTrace('[main] onLaunch shouldCreateContext=true')
  harness.readiness.onTrace('[main] onLaunch shouldCreateContext=true')
  assert.equal(harness.scheduled.size, 1)
  harness.expire()
  harness.expire()
  harness.readiness.onTrace('[main] app behaviors ready')
  assert.equal(harness.timeouts, 1)
  assert.deepEqual(harness.ready, [])
})

test('restart clears the previous boot timer and tracks the new installation', () => {
  const harness = createHarness()
  harness.readiness.start({ status: 'empty' })
  harness.readiness.onTrace('[main] onLaunch shouldCreateContext=true')
  harness.readiness.start({ status: 'prepared' })
  assert.equal(harness.scheduled.size, 0)
  harness.readiness.onTrace('[main] onLaunch shouldCreateContext=true')
  harness.readiness.onTrace('[main] app behaviors ready')
  assert.deepEqual(harness.ready, [{ status: 'prepared' }])
  harness.readiness.clear()
  harness.expire()
  assert.equal(harness.timeouts, 0)
})
