import assert from 'node:assert/strict'
import test from 'node:test'
import { NetworkConnectionStateMachine } from '../network-state.js'

test('NetworkConnectionStateMachine tracks scan retry and failure', () => {
  const state = new NetworkConnectionStateMachine({ maxScans: 1 })

  assert.equal(state.transition({ type: 'scan-started' }), 'scanning')
  assert.equal(state.transition({ type: 'scan-finished' }), 'scanning')
  assert.equal(state.transition({ type: 'scan-finished' }), 'failed')
  assert.equal(state.scanAttempts, 2)
})

test('NetworkConnectionStateMachine separates time sync and connected states', () => {
  const state = new NetworkConnectionStateMachine()

  assert.equal(state.transition({ type: 'connect-requested' }), 'connecting')
  assert.equal(state.transition({ type: 'got-ip' }), 'connected')
  assert.equal(state.transition({ type: 'time-sync-started' }), 'syncing-time')
  assert.equal(state.transition({ type: 'time-synced' }), 'connected')
  assert.equal(state.connectionEstablished, true)
})

test('NetworkConnectionStateMachine reconnects only after a prior connection', () => {
  const state = new NetworkConnectionStateMachine()

  assert.equal(state.transition({ type: 'connect-requested' }), 'connecting')
  assert.equal(state.transition({ type: 'disconnected' }), 'failed')

  assert.equal(state.transition({ type: 'connect-requested' }), 'connecting')
  assert.equal(state.transition({ type: 'got-ip' }), 'connected')
  assert.equal(state.transition({ type: 'disconnected' }), 'reconnecting')
})
