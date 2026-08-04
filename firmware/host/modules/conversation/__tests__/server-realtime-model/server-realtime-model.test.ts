import { sentJSON } from 'stackchanServerChatWebSocketWorker'
import ServerOpenAIRealtimeModel from 'stackchanServerOpenAIRealtimeModel'
import { equal } from 'testing/assert'
import Timer from 'timer'

trace('=== server-realtime-model test ===\n')

const model = new ServerOpenAIRealtimeModel({ inputSampleRate: 8000 })
const tool = {
  name: 'setEmotion',
  description: 'set the face emotion',
  parameters: {
    type: 'object',
    properties: { emotion: { type: 'string' } },
    required: ['emotion'],
  },
}
model.configure({
  providerID: 'wss://relay.example.test/device/v1/realtime',
  apiKey: 'test-token',
  voiceID: 'cedar',
  instructions: 'Be cheerful.',
  functions: [tool],
})
model['session.created']()

const sessionUpdate = sentJSON[0]
equal(sessionUpdate?.type, 'session.update', 'session creation should send a session update')
equal(sessionUpdate?.session?.instructions, 'Be cheerful.', 'session update should forward instructions')
equal(sessionUpdate?.session?.tools?.length, 1, 'session update should forward tools')
equal(sessionUpdate?.session?.tools?.[0]?.type, 'function', 'session tools should use the function type')
equal(sessionUpdate?.session?.tools?.[0]?.name, 'setEmotion', 'session update should preserve the tool name')
equal(
  sessionUpdate?.session?.tools?.[0]?.parameters?.additionalProperties,
  false,
  'session tools should reject undeclared parameters',
)
equal(sessionUpdate?.session?.tool_choice, 'auto', 'session update should enable automatic tool selection')

const barrier = new Int32Array(new SharedArrayBuffer(4 * Int32Array.BYTES_PER_ELEMENT))
const inputBuffer = new SharedArrayBuffer(2048)
model.connect({
  barrier,
  inputBuffer,
  outputBuffer: new SharedArrayBuffer(2048),
})
model.sendAudio({ offset: 0, size: 1024, sequence: 7 })
equal(Atomics.load(barrier, 1), 7, 'calibration input should acknowledge its transport sequence')

model.turnCommitted = true
model.sendAudio({ offset: 0, size: 1024, sequence: 8 })
equal(Atomics.load(barrier, 1), 8, 'suppressed input should acknowledge its transport sequence')

sentJSON.length = 0
model.sendFunctionResult({ call: 'call-1', result: { ok: true } })
equal(sentJSON.length, 2, 'a function result should be followed by a response request')
equal(sentJSON[0]?.type, 'conversation.item.create', 'the function output should be sent first')
equal(sentJSON[0]?.item?.type, 'function_call_output', 'the first item should contain the function output')
equal(sentJSON[0]?.item?.call_id, 'call-1', 'the function output should preserve the call id')
equal(sentJSON[0]?.item?.output, '{"ok":true}', 'the function output should serialize the result')
equal(sentJSON[1]?.type, 'response.create', 'the function output should resume the assistant response')

trace('ok\n')
Timer.set(() => {}, 1000)
