import assert from 'node:assert/strict'
import test from 'node:test'
import type { RemoteConversationTransportState, StackchanContext } from 'capabilities'
import { installRemoteSessionTestAliases } from './__tests__/node-aliases.js'
import type { ConversationRetryScheduler } from './conversation-session.js'
import type { RealtimeEventBridge, RealtimeEventSendResult, RealtimeToolProvider } from './realtime-session.js'
import './__tests__/approval-session-fake.js'

installRemoteSessionTestAliases()

const { createRemoteSessionRuntime } = await import('./runtime.js')

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

class FakeBridge implements RealtimeEventBridge {
  #eventHandler: ((event: string) => void) | undefined
  readonly sent: Array<Record<string, unknown>> = []

  setEventHandler(handler?: (event: string) => void): void {
    this.#eventHandler = handler
  }

  setTransportStateHandler(handler?: (state: RemoteConversationTransportState) => void): void {
    handler?.('ready')
  }

  sendEvent(serialized: string): Promise<RealtimeEventSendResult> {
    this.sent.push(JSON.parse(serialized) as Record<string, unknown>)
    return Promise.resolve('queued')
  }

  receive(event: Record<string, unknown>): void {
    this.#eventHandler?.(JSON.stringify(event))
  }
}

test('remote runtime retains stop delivery after its activation binding closes', async () => {
  const bridge = new FakeBridge()
  const scheduler = new FakeScheduler()
  const runtime = createRemoteSessionRuntime(bridge, scheduler)
  const activation = runtime.activate({} as StackchanContext, { tools: [] } satisfies RealtimeToolProvider)

  const requestId = activation.remoteConversationSession.requestStop()
  activation.close()
  await flushTasks()

  assert.deepEqual(
    bridge.sent.map((event) => event.type),
    ['conversation.stop'],
  )
  assert.equal(bridge.sent[0].requestId, requestId)

  scheduler.advance(2_000)
  await flushTasks()
  assert.deepEqual(
    bridge.sent.map((event) => event.requestId),
    [requestId, requestId],
  )

  bridge.receive({
    schema: 'stackchan.event.v1',
    type: 'conversation.result',
    requestId,
    success: true,
    state: 'standby',
  })
  await flushTasks()
  scheduler.advance(10_000)
  await flushTasks()

  assert.equal(bridge.sent.length, 2)
  runtime.close()
})

function flushTasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}
