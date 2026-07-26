import assert from 'node:assert/strict'
import test from 'node:test'
import type { RemoteConversationTransportState } from 'capabilities'
import { installRemoteSessionTestAliases } from './__tests__/node-aliases.js'
import type { RealtimeEventBridge, RealtimeEventSendResult } from './realtime-session.js'

installRemoteSessionTestAliases()

const { createRealtimeSession } = await import('./realtime-session.js')

class FakeBridge implements RealtimeEventBridge {
  handler: ((event: string) => void) | undefined
  transportHandler: ((state: RemoteConversationTransportState) => void) | undefined
  transportState: RemoteConversationTransportState = 'ready'
  sendResult: RealtimeEventSendResult = 'queued'
  sent: Array<Record<string, unknown>> = []

  setEventHandler(handler?: (event: string) => void): void {
    this.handler = handler
  }

  setTransportStateHandler(handler?: (state: RemoteConversationTransportState) => void): void {
    this.transportHandler = handler
    handler?.(this.transportState)
  }

  sendEvent(event: string): Promise<RealtimeEventSendResult> {
    this.sent.push(JSON.parse(event) as Record<string, unknown>)
    return Promise.resolve(this.sendResult)
  }

  receive(event: Record<string, unknown>): void {
    this.handler?.(JSON.stringify(event))
  }

  setTransportState(state: RemoteConversationTransportState): void {
    this.transportState = state
    this.transportHandler?.(state)
  }
}

test('realtime session sends the current tool catalog after session.created', async () => {
  const bridge = new FakeBridge()
  const session = createRealtimeSession(bridge)
  session.setProvider({
    instructions: 'LEDを使えます',
    tools: [
      {
        type: 'function',
        name: 'set_led',
        description: 'LEDを光らせる',
        parameters: { type: 'object' },
        execute: () => ({ ok: true }),
      },
    ],
  })

  bridge.receive({ type: 'session.created' })
  await flushTasks()

  assert.equal(bridge.sent[0].type, 'session.update')
  const sessionUpdate = bridge.sent[0].session as { instructions: string; tools: unknown[] }
  assert.equal(sessionUpdate.instructions, 'LEDを使えます')
  assert.equal(sessionUpdate.tools.length, 1)
  assert.equal('execute' in (sessionUpdate.tools[0] as object), false)
})

test('realtime session correlates function output and requests continuation', async () => {
  const bridge = new FakeBridge()
  const session = createRealtimeSession(bridge)
  session.setProvider({
    tools: [
      {
        type: 'function',
        name: 'set_led',
        description: '',
        parameters: { type: 'object' },
        execute: ({ color }) => ({ color }),
      },
    ],
  })

  bridge.receive({
    type: 'response.function_call_arguments.done',
    call_id: 'call-1',
    name: 'set_led',
    arguments: '{"color":"red"}',
  })
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(bridge.sent[0].type, 'conversation.item.create')
  assert.deepEqual(bridge.sent[0].item, {
    type: 'function_call_output',
    call_id: 'call-1',
    output: '{"color":"red"}',
  })
  assert.equal(bridge.sent[1].type, 'response.create')
})

test('realtime session routes valid application events before raw Realtime handling', async () => {
  const bridge = new FakeBridge()
  const session = createRealtimeSession(bridge)
  const received: string[] = []
  session.addApplicationEventHandler((event) => {
    received.push(event.type)
    return true
  })

  bridge.receive({
    schema: 'stackchan.event.v1',
    type: 'approval.request',
    requestId: 'request-1',
    kind: 'command',
    title: 'Run command',
    summary: 'npm test',
    detail: 'npm test',
    truncated: false,
  })
  bridge.receive({ type: 'session.created' })
  await flushTasks()

  assert.equal(received.length, 1)
  assert.equal(received[0], 'approval.request')
  assert.equal(bridge.sent[0].type, 'session.update')
})

test('realtime session composes approval and conversation handlers without one swallowing the other', () => {
  const bridge = new FakeBridge()
  const session = createRealtimeSession(bridge)
  const received: string[] = []
  const unsubscribeApproval = session.addApplicationEventHandler((event) => {
    if (event.type !== 'approval.request') return false
    received.push('approval')
    return true
  })
  session.addApplicationEventHandler((event) => {
    if (event.type !== 'conversation.result') return false
    received.push('conversation')
    return true
  })

  bridge.receive({
    schema: 'stackchan.event.v1',
    type: 'approval.request',
    requestId: 'approval-1',
    kind: 'command',
    title: 'Run command',
    summary: 'npm test',
    detail: 'npm test',
    truncated: false,
  })
  bridge.receive({
    schema: 'stackchan.event.v1',
    type: 'conversation.result',
    requestId: 'conversation-1',
    success: true,
    state: 'listening',
  })
  unsubscribeApproval()
  bridge.receive({
    schema: 'stackchan.event.v1',
    type: 'approval.request',
    requestId: 'approval-2',
    kind: 'fileChange',
    title: 'Change file',
    summary: 'main.ts',
    detail: 'main.ts',
    truncated: false,
  })

  assert.deepEqual(received, ['approval', 'conversation'])
})

test('malformed application events are consumed instead of reaching Realtime handling', () => {
  const bridge = new FakeBridge()
  createRealtimeSession(bridge)

  bridge.receive({
    schema: 'stackchan.event.v1',
    type: 'session.created',
    requestId: 'malformed-1',
  })

  assert.deepEqual(bridge.sent, [])
})

test('leaving ready clears the Android session marker until a new session.created arrives', async () => {
  const bridge = new FakeBridge()
  const session = createRealtimeSession(bridge)
  session.setProvider({ instructions: 'first', tools: [] })
  bridge.receive({ type: 'session.created' })
  await flushTasks()
  assert.equal(bridge.sent.length, 1)

  bridge.setTransportState('disconnected')
  bridge.setTransportState('ready')
  session.setProvider({ instructions: 'second', tools: [] })
  await flushTasks()
  assert.equal(bridge.sent.length, 1)

  bridge.receive({ type: 'session.created' })
  await flushTasks()
  assert.equal(bridge.sent.length, 2)
  assert.equal((bridge.sent[1].session as { instructions: string }).instructions, 'second')
})

test('realtime session exposes all transport-state transitions', () => {
  const bridge = new FakeBridge()
  const session = createRealtimeSession(bridge)
  const states: RemoteConversationTransportState[] = []
  session.subscribeTransport((state) => states.push(state))

  bridge.setTransportState('unsupported')
  bridge.setTransportState('disconnected')
  bridge.setTransportState('ready')

  assert.equal(session.transportState, 'ready')
  assert.deepEqual(states, ['unsupported', 'disconnected', 'ready'])
})

function flushTasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}
