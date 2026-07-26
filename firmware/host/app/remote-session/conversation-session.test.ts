import assert from 'node:assert/strict'
import test from 'node:test'
import type { RemoteConversationTransportState } from 'capabilities'
import { parseStackchanApplicationEvent } from './application-event.js'
import { installRemoteSessionTestAliases } from './__tests__/node-aliases.js'
import type { ConversationRetryScheduler } from './conversation-session.js'

installRemoteSessionTestAliases()

const { createConversationSession } = await import('./conversation-session.js')

class FakeScheduler implements ConversationRetryScheduler {
  now = 0
  #nextId = 0
  #tasks = new Map<number, { at: number; callback: () => void }>()

  set(callback: () => void, milliseconds: number): number {
    const id = ++this.#nextId
    this.#tasks.set(id, { at: this.now + milliseconds, callback })
    return id
  }

  clear(handle: unknown): void {
    this.#tasks.delete(handle as number)
  }

  advance(milliseconds: number): void {
    const target = this.now + milliseconds
    while (true) {
      const next = [...this.#tasks.entries()]
        .filter(([, task]) => task.at <= target)
        .sort((left, right) => left[1].at - right[1].at)[0]
      if (!next) break
      this.#tasks.delete(next[0])
      this.now = next[1].at
      next[1].callback()
    }
    this.now = target
  }
}

function createHarness(initialTransportState: RemoteConversationTransportState = 'ready') {
  const events: Array<Record<string, unknown>> = []
  const scheduler = new FakeScheduler()
  const transportListeners = new Set<(state: RemoteConversationTransportState) => void>()
  let transportState = initialTransportState
  let sequence = 0
  const session = createConversationSession(
    {
      get transportState() {
        return transportState
      },
      sendApplicationEvent(event) {
        events.push(event)
        return Promise.resolve('queued')
      },
      subscribeTransport(listener) {
        transportListeners.add(listener)
        return () => transportListeners.delete(listener)
      },
    },
    scheduler,
    {
      createRequestId: () => `touch-${++sequence}`,
    },
  )
  return {
    events,
    scheduler,
    session,
    setTransportState(nextState: RemoteConversationTransportState) {
      transportState = nextState
      for (const listener of transportListeners) listener(nextState)
    },
  }
}

test('conversation start retries the same request ID and accepts its result', () => {
  const { events, scheduler, session } = createHarness()
  const states: string[] = []
  session.remoteSession.subscribe((state) => states.push(state))

  const requestId = session.remoteSession.requestStart()
  scheduler.advance(4_000)

  assert.equal(requestId, 'touch-1')
  assert.equal(events.length, 3)
  assert.deepEqual(
    events.map((event) => event.requestId),
    ['touch-1', 'touch-1', 'touch-1'],
  )
  assert.equal(events[0].gesture, 'forwardSwipe')
  assert.equal(session.remoteSession.state, 'connecting')

  assert.equal(
    session.handleEvent({
      schema: 'stackchan.event.v1',
      type: 'conversation.result',
      requestId,
      success: true,
      state: 'listening',
    }),
    true,
  )
  scheduler.advance(10_000)

  assert.equal(events.length, 3)
  assert.equal(session.remoteSession.state, 'listening')
  assert.deepEqual(states, ['connecting', 'listening'])
})

test('conversation stop supersedes start and ignores the stale result', () => {
  const { events, session } = createHarness()
  const startId = session.remoteSession.requestStart()
  const stopId = session.remoteSession.requestStop()

  assert.notEqual(startId, stopId)
  assert.equal(events.at(-1)?.gesture, 'backwardSwipe')
  assert.equal(session.remoteSession.state, 'standby')

  session.handleEvent({
    schema: 'stackchan.event.v1',
    type: 'conversation.result',
    requestId: startId,
    success: true,
    state: 'listening',
  })
  assert.equal(session.remoteSession.state, 'standby')

  session.handleEvent({
    schema: 'stackchan.event.v1',
    type: 'conversation.result',
    requestId: stopId,
    success: true,
    state: 'standby',
  })
  assert.equal(session.remoteSession.state, 'standby')
})

test('conversation request stops retrying after ten seconds and exposes an error', () => {
  const { events, scheduler, session } = createHarness()
  session.remoteSession.requestStart()

  scheduler.advance(9_999)
  assert.equal(events.length, 5)
  scheduler.advance(1)

  assert.equal(events.length, 5)
  assert.equal(session.remoteSession.state, 'blocked')
  assert.match(session.remoteSession.lastError ?? '', /timed out/)
})

test('an unsupported Dock blocks immediately without sending or scheduling retries', () => {
  const { events, scheduler, session } = createHarness('unsupported')
  const transportStates: RemoteConversationTransportState[] = []
  session.remoteSession.subscribeTransport((state) => transportStates.push(state))

  const requestId = session.remoteSession.requestStart()
  scheduler.advance(20_000)

  assert.equal(requestId, 'touch-1')
  assert.equal(session.remoteSession.transportState, 'unsupported')
  assert.equal(session.remoteSession.state, 'blocked')
  assert.match(session.remoteSession.lastError ?? '', /does not support EVENT/)
  assert.deepEqual(events, [])
  assert.deepEqual(transportStates, [])
})

test('a disconnected request keeps its ID and sends immediately when EVENT becomes ready', () => {
  const { events, scheduler, session, setTransportState } = createHarness('disconnected')
  const transportStates: RemoteConversationTransportState[] = []
  session.remoteSession.subscribeTransport((state) => transportStates.push(state))

  const requestId = session.remoteSession.requestStart()
  scheduler.advance(4_000)
  assert.deepEqual(events, [])

  setTransportState('ready')
  assert.equal(events.length, 1)
  assert.equal(events[0].requestId, requestId)
  assert.equal(session.remoteSession.transportState, 'ready')

  scheduler.advance(2_000)
  assert.equal(events.length, 2)
  assert.deepEqual(transportStates, ['ready'])
})

test('a pending disconnected request still times out ten seconds after the gesture', () => {
  const { events, scheduler, session } = createHarness('disconnected')

  session.remoteSession.requestStop()
  scheduler.advance(10_000)

  assert.deepEqual(events, [])
  assert.equal(session.remoteSession.state, 'blocked')
  assert.match(session.remoteSession.lastError ?? '', /timed out after 10000 ms/)
})

test('losing negotiated EVENT support blocks a pending request and cancels retries', () => {
  const { events, scheduler, session, setTransportState } = createHarness()

  session.remoteSession.requestStart()
  setTransportState('unsupported')
  scheduler.advance(20_000)

  assert.equal(events.length, 1)
  assert.equal(session.remoteSession.transportState, 'unsupported')
  assert.equal(session.remoteSession.state, 'blocked')
  assert.match(session.remoteSession.lastError ?? '', /does not support EVENT/)
})

test('conversation result parser rejects malformed or unrelated events', () => {
  const { session } = createHarness()
  const requestId = session.remoteSession.requestStart()

  assert.equal(parseStackchanApplicationEvent({ type: 'conversation.result', requestId }), undefined)
  assert.equal(
    parseStackchanApplicationEvent({
      schema: 'stackchan.event.v1',
      type: 'conversation.result',
      requestId,
      success: 'yes',
      state: 'listening',
    }),
    undefined,
  )
  assert.equal(session.remoteSession.state, 'connecting')
})
