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

class FirstSendBlockingBridge extends FakeBridge {
  #release!: () => void
  #blockFirstSend = true
  readonly firstSendReleased = new Promise<void>((resolve) => {
    this.#release = resolve
  })

  override sendEvent(event: string): Promise<RealtimeEventSendResult> {
    this.sent.push(JSON.parse(event) as Record<string, unknown>)
    if (!this.#blockFirstSend) return Promise.resolve(this.sendResult)
    this.#blockFirstSend = false
    return this.firstSendReleased.then(() => this.sendResult)
  }

  releaseFirstSend(): void {
    this.#release()
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

test('realtime session ignores function calls while no activation owns a provider', async () => {
  const bridge = new FakeBridge()
  const session = createRealtimeSession(bridge)
  let executions = 0
  const provider = {
    tools: [
      {
        type: 'function' as const,
        name: 'set_led',
        description: '',
        parameters: { type: 'object' },
        execute: () => {
          executions += 1
          return { ok: true }
        },
      },
    ],
  }
  const functionCall = {
    type: 'response.function_call_arguments.done',
    call_id: 'call-inactive',
    name: 'set_led',
    arguments: '{}',
  }

  bridge.receive(functionCall)
  session.setProvider(provider)
  session.setProvider(undefined)
  bridge.receive(functionCall)
  await flushTasks()

  assert.equal(executions, 0)
  assert.deepEqual(bridge.sent, [])
})

test('realtime session discards a tool result after its activation lease ends', async () => {
  const bridge = new FakeBridge()
  const session = createRealtimeSession(bridge)
  let resolveTool!: (value: unknown) => void
  let executionStarted = false
  const toolResult = new Promise<unknown>((resolve) => {
    resolveTool = resolve
  })
  session.setProvider({
    instructions: 'first activation',
    tools: [
      {
        type: 'function',
        name: 'wait_for_result',
        description: '',
        parameters: { type: 'object' },
        execute: () => {
          executionStarted = true
          return toolResult
        },
      },
    ],
  })
  bridge.receive({ type: 'session.created' })
  await flushTasks()
  bridge.sent.length = 0

  bridge.receive({
    type: 'response.function_call_arguments.done',
    call_id: 'call-from-first-activation',
    name: 'wait_for_result',
    arguments: '{}',
  })
  await flushTasks()
  assert.equal(executionStarted, true)

  session.setProvider(undefined)
  session.setProvider({ instructions: 'second activation', tools: [] })
  await flushTasks()
  resolveTool({ stale: true })
  await flushTasks()

  assert.equal(bridge.sent.length, 1)
  assert.equal(bridge.sent[0].type, 'session.update')
  assert.equal((bridge.sent[0].session as { instructions: string }).instructions, 'second activation')
})

test('realtime session rechecks the activation lease while function output waits in the send queue', async () => {
  const bridge = new FirstSendBlockingBridge()
  const session = createRealtimeSession(bridge)
  let executions = 0
  session.setProvider({
    tools: [
      {
        type: 'function',
        name: 'finish_immediately',
        description: '',
        parameters: { type: 'object' },
        execute: () => {
          executions += 1
          return { ok: true }
        },
      },
    ],
  })
  void session.sendApplicationEvent({
    schema: 'stackchan.event.v1',
    type: 'approval.presented',
    requestId: 'queue-blocker',
  })
  await flushTasks()
  assert.equal(bridge.sent.length, 1)

  bridge.receive({
    type: 'response.function_call_arguments.done',
    call_id: 'queued-call',
    name: 'finish_immediately',
    arguments: '{}',
  })
  await flushTasks()
  assert.equal(executions, 1)
  session.setProvider(undefined)
  bridge.releaseFirstSend()
  await flushTasks()

  assert.deepEqual(
    bridge.sent.map((event) => event.type),
    ['approval.presented'],
  )
})

test('realtime session does not continue a function response after its lease ends mid-batch', async () => {
  const bridge = new FirstSendBlockingBridge()
  const session = createRealtimeSession(bridge)
  session.setProvider({
    tools: [
      {
        type: 'function',
        name: 'finish_immediately',
        description: '',
        parameters: { type: 'object' },
        execute: () => ({ ok: true }),
      },
    ],
  })

  bridge.receive({
    type: 'response.function_call_arguments.done',
    call_id: 'mid-batch-call',
    name: 'finish_immediately',
    arguments: '{}',
  })
  await flushTasks()
  assert.deepEqual(
    bridge.sent.map((event) => event.type),
    ['conversation.item.create'],
  )

  session.setProvider(undefined)
  bridge.releaseFirstSend()
  await flushTasks()

  assert.deepEqual(
    bridge.sent.map((event) => event.type),
    ['conversation.item.create'],
  )
})

test('realtime session does not request a continuation when function output was not queued', async () => {
  const bridge = new FakeBridge()
  bridge.sendResult = 'overflow'
  const session = createRealtimeSession(bridge)
  session.setProvider({
    tools: [
      {
        type: 'function',
        name: 'finish_immediately',
        description: '',
        parameters: { type: 'object' },
        execute: () => ({ ok: true }),
      },
    ],
  })

  bridge.receive({
    type: 'response.function_call_arguments.done',
    call_id: 'overflow-call',
    name: 'finish_immediately',
    arguments: '{}',
  })
  await flushTasks()

  assert.deepEqual(
    bridge.sent.map((event) => event.type),
    ['conversation.item.create'],
  )
})

test('realtime session routes application events but defers session.update until activation', async () => {
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
  assert.equal(bridge.sent.length, 0)

  session.setProvider({ instructions: 'activation instructions', tools: [] })
  await flushTasks()

  assert.equal(bridge.sent.length, 1)
  assert.equal(bridge.sent[0].type, 'session.update')
  assert.equal((bridge.sent[0].session as { instructions: string }).instructions, 'activation instructions')
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
