import assert from 'node:assert/strict'
import test from 'node:test'
import { NetworkConnectionState, NetworkConnectionStateMachine } from '../network-state.js'

test('NetworkConnectionStateMachine tracks scan retry and failure', () => {
  const state = new NetworkConnectionStateMachine({ maxScans: 1 })

  assert.equal(state.transition({ type: 'scan-started' }), NetworkConnectionState.SCANNING)
  assert.equal(state.transition({ type: 'scan-finished' }), NetworkConnectionState.FAILED)
  assert.equal(state.scanAttempts, 1)
})

test('NetworkConnectionStateMachine separates time sync and connected states', () => {
  const state = new NetworkConnectionStateMachine()

  assert.equal(state.transition({ type: 'connect-requested' }), NetworkConnectionState.CONNECTING)
  assert.equal(state.transition({ type: 'got-ip' }), NetworkConnectionState.CONNECTED)
  assert.equal(state.transition({ type: 'time-sync-started' }), NetworkConnectionState.SYNCING_TIME)
  assert.equal(state.transition({ type: 'time-synced' }), NetworkConnectionState.CONNECTED)
  assert.equal(state.connectionEstablished, true)
})

test('NetworkConnectionStateMachine reconnects only after a prior connection', () => {
  const state = new NetworkConnectionStateMachine()

  assert.equal(state.transition({ type: 'connect-requested' }), NetworkConnectionState.CONNECTING)
  assert.equal(state.transition({ type: 'disconnected' }), NetworkConnectionState.FAILED)

  assert.equal(state.transition({ type: 'connect-requested' }), NetworkConnectionState.CONNECTING)
  assert.equal(state.transition({ type: 'got-ip' }), NetworkConnectionState.CONNECTED)
  assert.equal(state.transition({ type: 'disconnected' }), NetworkConnectionState.RECONNECTING)
})
