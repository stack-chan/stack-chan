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
const { ChatConversation } = await import('../chat.ts')

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
  const conversation = ChatConversation.create({
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

test('Chat exposes accepted text without inventing correlated turn completion and normalizes transcript snapshots', async () => {
  class WorkerIO extends FakeIO {
    connect() {
      this.emitState(FakeIO.CONNECTED)
    }
    async drain() {}
    async fence() {
      return []
    }
  }
  const conversation = ChatConversation.create({ config: { type: 'openAIRealtime' }, chatAudioIOCtor: WorkerIO })
  assert.deepEqual(conversation.capabilities.inputRoles, ['user'])
  assert.equal(conversation.capabilities.interruptionReuse, 'restart-required')
  assert.equal(conversation.capabilities.submitCompletion, 'unavailable')
  const scope = createVoiceScope()
  const events = []
  const session = await conversation.open({ ...scope, media: {}, history: [], onEvent: (event) => events.push(event) })
  const message = { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] }
  try {
    assert.deepEqual(await session.submit(message, scope), { completion: 'unavailable' })
    const io = FakeIO.instances.at(-1)
    assert.equal(io.lastText, 'hello')
    await assert.rejects(session.submit({ ...message, role: 'system' }, scope), { code: 'unsupported_capability' })
    await assert.rejects(
      session.submit(
        { ...message, content: [{ type: 'input_image', image_url: 'https://example.test/a.png' }] },
        scope,
      ),
      { code: 'unsupported_capability' },
    )
    io.emitInputTranscript('hello ', true)
    io.emitInputTranscript('world', false)
    io.emitInputTranscript('next', false)
    const transcripts = events.filter((event) => event.type === 'input.transcript').map((event) => event.value)
    assert.deepEqual(
      transcripts.map(({ text, final }) => ({ text, final })),
      [
        { text: 'hello ', final: false },
        { text: 'hello world', final: true },
        { text: 'next', final: true },
      ],
    )
    assert.equal(transcripts[0].utteranceId, transcripts[1].utteranceId)
    assert.notEqual(transcripts[1].utteranceId, transcripts[2].utteranceId)
    assert.equal((await session.interrupt()).history, 'restart-required')
    await assert.rejects(session.submit(message, scope), { code: 'cancelled' })
  } finally {
    await session.close({ mode: 'abort' })
  }
})
