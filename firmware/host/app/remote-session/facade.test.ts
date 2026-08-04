import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  RemoteConversationListener,
  RemoteConversationSessionDelegate,
  RemoteConversationState,
  RemoteConversationTransportListener,
  RemoteConversationTransportState,
} from 'capabilities'
import { createRemoteConversationSessionFacade } from './facade.js'

class FakeRemoteSession implements RemoteConversationSessionDelegate {
  state: RemoteConversationState = 'standby'
  lastError: string | undefined
  transportState: RemoteConversationTransportState = 'disconnected'
  readonly stateListeners = new Set<RemoteConversationListener>()
  readonly transportListeners = new Set<RemoteConversationTransportListener>()
  startRequests = 0
  stopRequests = 0

  requestStart(): string {
    this.startRequests += 1
    return `start-${this.startRequests}`
  }

  requestStop(): string {
    this.stopRequests += 1
    return `stop-${this.stopRequests}`
  }

  subscribe(listener: RemoteConversationListener): () => void {
    this.stateListeners.add(listener)
    return () => this.stateListeners.delete(listener)
  }

  subscribeTransport(listener: RemoteConversationTransportListener): () => void {
    this.transportListeners.add(listener)
    return () => this.transportListeners.delete(listener)
  }

  updateState(state: RemoteConversationState, error?: string): void {
    this.state = state
    this.lastError = error
    for (const listener of this.stateListeners) listener(state, error)
  }

  updateTransport(state: RemoteConversationTransportState): void {
    this.transportState = state
    for (const listener of this.transportListeners) listener(state)
  }
}

test('inactive facade rejects requests and activates one binding idempotently', () => {
  const delegate = new FakeRemoteSession()
  let creates = 0
  let closes = 0
  const facade = createRemoteConversationSessionFacade(() => {
    creates += 1
    return {
      remoteSession: delegate,
      close() {
        closes += 1
      },
    }
  })

  assert.equal(facade.remoteSession.activationState, 'inactive')
  assert.equal(facade.remoteSession.state, 'standby')
  assert.equal(facade.remoteSession.lastError, undefined)
  assert.equal(facade.remoteSession.transportState, 'disconnected')
  assert.throws(() => facade.remoteSession.requestStart(), /inactive/)
  assert.throws(() => facade.remoteSession.requestStop(), /inactive/)

  facade.remoteSession.activate()
  facade.remoteSession.activate()

  assert.equal(creates, 1)
  assert.equal(facade.remoteSession.activationState, 'active')
  assert.equal(facade.remoteSession.requestStart(), 'start-1')
  assert.equal(facade.remoteSession.requestStop(), 'stop-1')
  assert.equal(closes, 0)
})

test('listeners survive deactivate and receive updates after reactivation', () => {
  const delegates = [new FakeRemoteSession(), new FakeRemoteSession()]
  let creates = 0
  let closes = 0
  const facade = createRemoteConversationSessionFacade(() => {
    const delegate = delegates[creates++]
    return {
      remoteSession: delegate,
      close() {
        closes += 1
      },
    }
  })
  const states: Array<[RemoteConversationState, string | undefined]> = []
  const transports: RemoteConversationTransportState[] = []
  facade.remoteSession.subscribe((state, error) => states.push([state, error]))
  facade.remoteSession.subscribeTransport((state) => transports.push(state))

  facade.remoteSession.activate()
  delegates[0].updateState('listening')
  delegates[0].updateTransport('ready')
  facade.remoteSession.deactivate()
  facade.remoteSession.deactivate()

  assert.equal(facade.remoteSession.activationState, 'inactive')
  assert.equal(closes, 1)
  assert.equal(delegates[0].stopRequests, 1)
  assert.deepEqual(states, [
    ['listening', undefined],
    ['standby', undefined],
  ])
  assert.deepEqual(transports, ['ready', 'disconnected'])
  assert.equal(delegates[0].stateListeners.size, 0)
  assert.equal(delegates[0].transportListeners.size, 0)

  facade.remoteSession.activate()
  delegates[1].updateState('blocked', 'retry failed')
  delegates[1].updateTransport('unsupported')

  assert.equal(creates, 2)
  assert.equal(facade.remoteSession.activationState, 'active')
  assert.equal(facade.remoteSession.lastError, 'retry failed')
  assert.deepEqual(states.at(-1), ['blocked', 'retry failed'])
  assert.equal(transports.at(-1), 'unsupported')
})

test('activation failure cleans a returned binding and remains retryable', () => {
  const invalidDelegate = new FakeRemoteSession()
  invalidDelegate.subscribeTransport = () => {
    throw new Error('subscribe failed')
  }
  const validDelegate = new FakeRemoteSession()
  let creates = 0
  let closes = 0
  const facade = createRemoteConversationSessionFacade(() => ({
    remoteSession: creates++ === 0 ? invalidDelegate : validDelegate,
    close() {
      closes += 1
    },
  }))

  assert.throws(() => facade.remoteSession.activate(), /subscribe failed/)
  assert.equal(facade.remoteSession.activationState, 'inactive')
  assert.equal(invalidDelegate.stateListeners.size, 0)
  assert.equal(closes, 1)

  facade.remoteSession.activate()
  assert.equal(facade.remoteSession.activationState, 'active')
  assert.equal(creates, 2)
})

test('deactivation attempts all cleanup and leaves the facade inactive', () => {
  const delegate = new FakeRemoteSession()
  delegate.subscribe = (listener) => {
    delegate.stateListeners.add(listener)
    return () => {
      delegate.stateListeners.delete(listener)
      throw new Error('unsubscribe failed')
    }
  }
  let closed = false
  const facade = createRemoteConversationSessionFacade(() => ({
    remoteSession: delegate,
    close() {
      closed = true
      throw new Error('binding close failed')
    },
  }))

  facade.remoteSession.activate()
  assert.throws(() => facade.remoteSession.deactivate(), /unsubscribe failed/)

  assert.equal(closed, true)
  assert.equal(facade.remoteSession.activationState, 'inactive')
  assert.equal(facade.remoteSession.state, 'standby')
  assert.equal(facade.remoteSession.transportState, 'disconnected')
})

test('final close is idempotent and prevents reactivation', () => {
  const delegate = new FakeRemoteSession()
  let closes = 0
  const facade = createRemoteConversationSessionFacade(() => ({
    remoteSession: delegate,
    close() {
      closes += 1
    },
  }))

  facade.remoteSession.activate()
  facade.close()
  facade.close()

  assert.equal(closes, 1)
  assert.equal(delegate.stopRequests, 1)
  assert.equal(facade.remoteSession.activationState, 'inactive')
  assert.throws(() => facade.remoteSession.activate(), /closed/)
})
