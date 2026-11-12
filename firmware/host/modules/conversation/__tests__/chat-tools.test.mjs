import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import FakeIO from '../../testing/fakes/ChatAudioIO.js'
import { createVoiceScope } from '../../voice/scope.ts'

const aliases = {
  StackChanChatAudioIO: new URL('../../testing/fakes/ChatAudioIO.js', import.meta.url).href,
  'chat-state': new URL('../chat-state.ts', import.meta.url).href,
  'stackchan/voice/scope': new URL('../../voice/scope.ts', import.meta.url).href,
  'mc/config': 'data:text/javascript,export default {xiaozhiV1Available:true}',
  timer: 'data:text/javascript,export default {set:setTimeout,clear:clearTimeout}',
}
registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(aliases[specifier] ?? specifier, context)
  },
})
const { createChatConversation } = await import('../chat.ts')

test('Chat executes and replies to more than 256 distinct tool requests in one session', async () => {
  let executions = 0
  const replies = []
  class WorkerIO extends FakeIO {
    connect() {
      this.emitState(FakeIO.CONNECTED)
    }
    async drain() {}
    async fence() {
      return []
    }
    sendFunctionResult(call, name, result) {
      replies.push({ call, name, result })
    }
  }
  const conversation = createChatConversation({
    connection: { endpoint: 'wss://example.test/ws', deviceId: 'device', clientId: 'client' },
    chatAudioIOCtor: WorkerIO,
    tools: {
      definitions: [],
      async execute(call) {
        executions++
        return { type: 'function_call_output', call_id: call.call_id, output: 'ok' }
      },
    },
  })
  const session = await conversation.open({ ...createVoiceScope(), media: {}, history: [], onEvent() {} })
  try {
    const io = FakeIO.instances.at(-1)
    for (let i = 0; i < 300; i++) {
      const call = 'mcp:number:' + i
      io.emitFunctionCall(call, 'echo', {})
      await new Promise(setImmediate)
      assert.deepEqual(replies.at(-1), { call, name: 'echo', result: 'ok' })
    }
    assert.equal(executions, 300)
    assert.equal(replies.length, 300)
  } finally {
    await session.close({ mode: 'abort' })
  }
})
