import assert from 'node:assert/strict'
import test from 'node:test'
import { createUsbRealtimeSession, type RealtimeEventBridge } from './usb-realtime-session.js'

class FakeBridge implements RealtimeEventBridge {
  handler: ((event: string) => void) | undefined
  sent: Array<Record<string, unknown>> = []

  setEventHandler(handler?: (event: string) => void): void {
    this.handler = handler
  }

  sendEvent(event: string): void {
    this.sent.push(JSON.parse(event) as Record<string, unknown>)
  }

  receive(event: Record<string, unknown>): void {
    this.handler?.(JSON.stringify(event))
  }
}

test('USB realtime session sends the current tool catalog after session.created', () => {
  const bridge = new FakeBridge()
  const session = createUsbRealtimeSession(bridge)
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

  assert.equal(bridge.sent[0].type, 'session.update')
  const sessionUpdate = bridge.sent[0].session as { instructions: string; tools: unknown[] }
  assert.equal(sessionUpdate.instructions, 'LEDを使えます')
  assert.equal(sessionUpdate.tools.length, 1)
  assert.equal('execute' in (sessionUpdate.tools[0] as object), false)
})

test('USB realtime session correlates function output and requests continuation', async () => {
  const bridge = new FakeBridge()
  const session = createUsbRealtimeSession(bridge)
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

test('USB realtime session routes namespaced application events before raw Realtime handling', () => {
  const bridge = new FakeBridge()
  const session = createUsbRealtimeSession(bridge)
  const received: Array<Record<string, unknown>> = []
  session.setApplicationEventHandler((event) => {
    if (event.schema !== 'stackchan.event.v1') return false
    received.push(event)
    return true
  })

  bridge.receive({
    schema: 'stackchan.event.v1',
    type: 'approval.request',
    requestId: 'request-1',
  })
  bridge.receive({ type: 'session.created' })

  assert.equal(received.length, 1)
  assert.equal(received[0].requestId, 'request-1')
  assert.equal(bridge.sent[0].type, 'session.update')
})

test('USB realtime session composes and unsubscribes application event handlers', () => {
  const bridge = new FakeBridge()
  const session = createUsbRealtimeSession(bridge)
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

  bridge.receive({ schema: 'stackchan.event.v1', type: 'approval.request' })
  bridge.receive({ schema: 'stackchan.event.v1', type: 'conversation.result' })
  unsubscribeApproval()
  bridge.receive({ schema: 'stackchan.event.v1', type: 'approval.request' })

  assert.deepEqual(received, ['approval', 'conversation'])
})
