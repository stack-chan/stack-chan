import assert from 'node:assert/strict'
import test from 'node:test'
import type { RemoteConversationTransportState } from 'capabilities'
import { installRemoteSessionTestAliases } from './__tests__/node-aliases.js'
import type { StackchanInboundApplicationEvent } from './application-event.js'
import type { TaskSessionTransport } from './task-session.js'

installRemoteSessionTestAliases()

const { createTaskSession } = await import('./task-session.js')

class FakeTransport implements TaskSessionTransport {
  applicationHandler: ((event: StackchanInboundApplicationEvent) => boolean) | undefined
  transportListener: ((state: RemoteConversationTransportState) => void) | undefined

  addApplicationEventHandler(handler: (event: StackchanInboundApplicationEvent) => boolean): () => void {
    this.applicationHandler = handler
    return () => {
      this.applicationHandler = undefined
    }
  }

  subscribeTransport(listener: (state: RemoteConversationTransportState) => void): () => void {
    this.transportListener = listener
    return () => {
      this.transportListener = undefined
    }
  }
}

test('task session exposes snapshots independently from conversation state', () => {
  const transport = new FakeTransport()
  const session = createTaskSession(transport)
  const states: string[] = []
  session.subscribe((state) => states.push(state))

  assert.equal(session.state, 'idle')
  assert.equal(
    transport.applicationHandler?.({
      schema: 'stackchan.event.v1',
      type: 'conversation.result',
      requestId: 'conversation-1',
      success: true,
      state: 'speaking',
    }),
    false,
  )
  assert.equal(
    transport.applicationHandler?.({
      schema: 'stackchan.event.v1',
      type: 'task.status',
      requestId: 'task-1',
      state: 'running',
    }),
    true,
  )
  transport.applicationHandler?.({
    schema: 'stackchan.event.v1',
    type: 'task.status',
    requestId: 'task-2',
    state: 'running',
  })

  assert.equal(session.state, 'running')
  assert.deepEqual(states, ['idle', 'running'])
})

test('task session resets on every non-ready transport state and on close', () => {
  const transport = new FakeTransport()
  const session = createTaskSession(transport)
  const states: string[] = []
  session.subscribe((state) => states.push(state))
  transport.applicationHandler?.({
    schema: 'stackchan.event.v1',
    type: 'task.status',
    requestId: 'task-1',
    state: 'running',
  })

  transport.transportListener?.('disconnected')
  transport.applicationHandler?.({
    schema: 'stackchan.event.v1',
    type: 'task.status',
    requestId: 'task-2',
    state: 'running',
  })
  transport.transportListener?.('unsupported')
  session.close()

  assert.deepEqual(states, ['idle', 'running', 'idle', 'running', 'idle'])
  assert.equal(session.state, 'idle')
  assert.equal(transport.applicationHandler, undefined)
  assert.equal(transport.transportListener, undefined)
})

test('task session rolls back a subscriber whose initial snapshot throws', () => {
  const transport = new FakeTransport()
  const session = createTaskSession(transport)
  let calls = 0

  assert.throws(
    () =>
      session.subscribe(() => {
        calls += 1
        throw new Error('presentation failed')
      }),
    /presentation failed/,
  )

  transport.applicationHandler?.({
    schema: 'stackchan.event.v1',
    type: 'task.status',
    requestId: 'task-after-failure',
    state: 'running',
  })

  assert.equal(calls, 1)
  assert.equal(session.state, 'running')
})
