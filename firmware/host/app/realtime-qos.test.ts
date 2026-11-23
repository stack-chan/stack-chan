import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createRealtimePerformanceScope,
  createRealtimeQoS,
  type OperatingMode,
  type RealtimeQoSAdapter,
} from './realtime-qos.js'

test('createRealtimeQoS works without an adapter and tracks operating modes', () => {
  const qos = createRealtimeQoS()
  assert.equal(qos.mode, 'idle')

  qos.prepare()
  const lease = qos.enterMode('realtime-conversation')
  assert.equal(qos.mode, 'realtime-conversation')

  lease.release()
  lease.release()
  assert.equal(qos.mode, 'idle')
})

test('prepare is idempotent after succeeding and retries after a transient failure', () => {
  let prepareCalls = 0
  let shouldFail = true
  const qos = createRealtimeQoS({
    prepare() {
      prepareCalls += 1
      if (shouldFail) {
        shouldFail = false
        throw new Error('screen not ready')
      }
    },
    acquire() {
      return undefined
    },
  })

  assert.throws(() => qos.prepare(), /screen not ready/)
  qos.prepare()
  qos.prepare()
  assert.equal(prepareCalls, 2)
})

test('stacked and out-of-order leases restore the latest remaining active mode', () => {
  const acquired: OperatingMode[] = []
  const released: OperatingMode[] = []
  const adapter: RealtimeQoSAdapter = {
    acquire(mode) {
      acquired.push(mode)
      if (mode === 'idle') return undefined
      return {
        release() {
          released.push(mode)
        },
      }
    },
  }

  const qos = createRealtimeQoS(adapter)
  const wake = qos.enterMode('wake-listening')
  assert.equal(qos.mode, 'wake-listening')

  const conversation = qos.enterMode('realtime-conversation')
  assert.equal(qos.mode, 'realtime-conversation')

  conversation.release()
  conversation.release()
  assert.equal(qos.mode, 'wake-listening')
  assert.deepEqual(released, ['realtime-conversation'])

  const media1 = qos.enterMode('media-playback')
  const media2 = qos.enterMode('media-playback')
  assert.equal(qos.mode, 'media-playback')

  wake.release()
  assert.equal(qos.mode, 'media-playback')

  media1.release()
  assert.equal(qos.mode, 'media-playback')

  media2.release()
  assert.equal(qos.mode, 'idle')

  assert.deepEqual(acquired, ['wake-listening', 'realtime-conversation', 'media-playback', 'media-playback'])
  assert.deepEqual(released, ['realtime-conversation', 'wake-listening', 'media-playback', 'media-playback'])
})

test('enterMode rolls back without mutating mode when adapter.acquire throws', () => {
  let failAcquire = true
  const qos = createRealtimeQoS({
    acquire(mode) {
      if (mode === 'realtime-conversation' && failAcquire) {
        throw new Error('wifi driver error')
      }
      return { release() {} }
    },
  })

  const wake = qos.enterMode('wake-listening')
  assert.equal(qos.mode, 'wake-listening')

  assert.throws(() => qos.enterMode('realtime-conversation'), /wifi driver error/)
  assert.equal(qos.mode, 'wake-listening')

  failAcquire = false
  const conversation = qos.enterMode('realtime-conversation')
  assert.equal(qos.mode, 'realtime-conversation')
  conversation.release()
  assert.equal(qos.mode, 'wake-listening')
  wake.release()
  assert.equal(qos.mode, 'idle')
})

test('release restores active mode and stays idempotent even if adapter release throws', () => {
  let innerReleaseCalls = 0
  const qos = createRealtimeQoS({
    acquire(mode) {
      if (mode !== 'realtime-conversation') return undefined
      return {
        release() {
          innerReleaseCalls += 1
          throw new Error('restore priority failed')
        },
      }
    },
  })

  const wake = qos.enterMode('wake-listening')
  const conversation = qos.enterMode('realtime-conversation')
  assert.equal(qos.mode, 'realtime-conversation')

  assert.throws(() => conversation.release(), /restore priority failed/)
  assert.equal(qos.mode, 'wake-listening')
  assert.equal(innerReleaseCalls, 1)

  conversation.release()
  assert.equal(innerReleaseCalls, 1)
  assert.equal(qos.mode, 'wake-listening')

  wake.release()
  assert.equal(qos.mode, 'idle')
})

test('conversation performance promotes before releasing the connection lease and closes outstanding sessions', () => {
  const events: string[] = []
  const qos = createRealtimeQoS({
    acquire(mode) {
      events.push(`acquire ${mode}`)
      return { release: () => events.push(`release ${mode}`) }
    },
  })
  const scope = createRealtimePerformanceScope(qos)
  const connected = scope.open()
  connected.connected()
  connected.connected()
  const connecting = scope.open()
  assert.equal(qos.mode, 'realtime-connecting')

  scope.close()
  connected.close()
  connecting.connected()
  assert.equal(qos.mode, 'idle')
  assert.deepEqual(events, [
    'acquire realtime-connecting',
    'acquire realtime-conversation',
    'release realtime-connecting',
    'acquire realtime-connecting',
    'release realtime-conversation',
    'release realtime-connecting',
  ])
})

test('a failed promotion keeps its connection lease until shutdown, which releases all sessions', () => {
  let releaseCount = 0
  const qos = createRealtimeQoS({
    acquire(mode) {
      if (mode === 'realtime-conversation') throw new Error('UI unavailable')
      return {
        release() {
          releaseCount += 1
          if (releaseCount === 1) throw new Error('release failed')
        },
      }
    },
  })
  const scope = createRealtimePerformanceScope(qos)
  const session = scope.open()
  assert.throws(() => session.connected(), /UI unavailable/)
  assert.equal(qos.mode, 'realtime-connecting')
  scope.open()
  assert.throws(() => scope.close(), /release failed/)
  assert.equal(releaseCount, 2)
  assert.equal(qos.mode, 'idle')
})
