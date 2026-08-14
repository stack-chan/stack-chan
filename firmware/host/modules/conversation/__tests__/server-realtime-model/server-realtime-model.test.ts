import { postedMessages, sentJSON } from 'stackchanServerChatWebSocketWorker'
import ServerOpenAIRealtimeModel, { parseWebSocketEndpoint } from 'stackchanServerOpenAIRealtimeModel'
import { equal } from 'testing/assert'
import Timer from 'timer'

trace('=== server-realtime-model test ===\n')

const localEndpoint = parseWebSocketEndpoint('ws://192.168.7.140:8787/device/v1/realtime?conversation_id=test')
equal(localEndpoint.secure, false, 'a LAN websocket endpoint should use the cleartext transport')
equal(localEndpoint.host, '192.168.7.140', 'endpoint host should be parsed')
equal(localEndpoint.port, 8787, 'endpoint port should be parsed')
equal(
  localEndpoint.path,
  '/device/v1/realtime?conversation_id=test',
  'endpoint path should retain conversation query parameters',
)

const connection = {
  barrier: new Int32Array(new SharedArrayBuffer(4 * Int32Array.BYTES_PER_ELEMENT)),
  inputBuffer: new SharedArrayBuffer(2048),
  outputBuffer: new SharedArrayBuffer(2048),
}
const reconfiguredModel = new ServerOpenAIRealtimeModel({ inputSampleRate: 8000 })
reconfiguredModel.configure({ providerID: 'https://relay.example.test/device/v1/realtime' })
reconfiguredModel.connect(connection)
equal(postedMessages.length, 1, 'a non-WebSocket endpoint should fail before connecting')
equal(
  postedMessages[0]?.string,
  'ChatService endpoint must use ws:// or wss://',
  'the endpoint failure should be explicit',
)
postedMessages.length = 0
reconfiguredModel.configure({
  providerID: 'ws://relay.example.test/device/v1/realtime',
  apiKey: 'test-token',
})
reconfiguredModel.connect(connection)
equal(postedMessages.length, 1, 'Bearer authentication should be rejected on public ws endpoints')
equal(
  postedMessages[0]?.string,
  'ChatService Bearer authentication over ws:// is restricted to trusted local networks',
  'the public cleartext authentication failure should be explicit',
)
postedMessages.length = 0
reconfiguredModel.configure({
  providerID: 'ws://192.168.7.140:8787/device/v1/realtime?token=device-token',
})
reconfiguredModel.connect(connection)
equal(postedMessages.length, 1, 'credentials should be rejected in a cleartext endpoint URL')
equal(postedMessages[0]?.string, 'ChatService credentials must not be embedded in a ws:// endpoint')
postedMessages.length = 0
reconfiguredModel.configure({
  providerID: 'ws://192.168.7.140:8787/device/v1/realtime?conversation_id=test',
  apiKey: 'device-token',
})
reconfiguredModel.connect(connection)
equal(reconfiguredModel.connectCount, 1, 'a valid trusted-LAN configuration should replace earlier failures')
equal(postedMessages.length, 0, 'a valid reconfiguration should not retain an earlier failure')
equal(reconfiguredModel.headers[0]?.[0], 'Authorization', 'trusted-LAN authentication should use a header')
equal(reconfiguredModel.headers[0]?.[1], 'Bearer device-token', 'the device token should stay out of the endpoint URL')

const tunedModel = new ServerOpenAIRealtimeModel({ inputSampleRate: 8000 })
tunedModel.configure({
  providerID: 'wss://relay.example.test/fixture/device/v1/realtime?sample_rate=16000&codec=pcm16&encoding=base64',
})
equal(tunedModel.session.audio.output.format.rate, 16000, 'sample_rate should select the PCM output rate')
equal(tunedModel.session.audio.output.binary, false, 'encoding=base64 should keep JSON audio events')
equal(tunedModel.outputMinimum, 8000, 'the parser minimum should follow the selected sample rate')
equal(postedMessages[0]?.id, 'configureAudio', 'a rate change should reconfigure AudioOut')
equal(postedMessages[0]?.outputSampleRate, 16000, 'AudioOut should use the selected sample rate')
postedMessages.length = 0
tunedModel.configure({
  providerID: 'wss://relay.example.test/fixture/device/v1/realtime?codec=opus',
})
tunedModel.connect(connection)
equal(postedMessages[0]?.id, 'failed', 'an unsupported codec should fail before connecting')
equal(postedMessages[0]?.string, 'ChatService codec must be pcm16')
postedMessages.length = 0

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
equal(model.binaryInput, true, 'the server model should send PCMA input as binary frames')
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
equal(sessionUpdate?.session?.audio?.output?.binary, true, 'session update should request binary output audio')

model.connect(connection)
const input = new Uint8Array(connection.inputBuffer)
input.set([0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70, 0x80])
model.sendAudio({ offset: 0, size: 8, sequence: 7 })
equal(model.lastAudio?.size, 4, 'PCM16 input should be encoded to one byte per PCMA sample')
equal(model.lastAudioBuffer?.byteLength, 4, 'only encoded PCMA bytes should reach the transport')
equal(model.lastAudioBuffer?.[0], 0x20 ^ 0x55, 'the first encoded sample should reach the transport')
equal(model.lastAudioBuffer?.[3], 0x80 ^ 0x55, 'the final encoded sample should reach the transport')

sentJSON.length = 0
model.sendFunctionResult({ call: 'call-1', result: { ok: true } })
equal(sentJSON.length, 2, 'a function result should be followed by a response request')
equal(sentJSON[0]?.type, 'conversation.item.create', 'the function output should be sent first')
equal(sentJSON[0]?.item?.type, 'function_call_output', 'the first item should contain the function output')
equal(sentJSON[0]?.item?.call_id, 'call-1', 'the function output should preserve the call id')
equal(sentJSON[0]?.item?.output, '{"ok":true}', 'the function output should serialize the result')
equal(sentJSON[1]?.type, 'response.create', 'the function output should resume the assistant response')

postedMessages.length = 0
const receivedAudioCount = () => postedMessages.filter((message) => message.id === 'receiveAudio').length
model['response.created']()
equal(
  postedMessages.some((message) => message.id === 'wait'),
  true,
  'response generation should enter the waiting state',
)
equal(
  postedMessages.some((message) => message.id === 'listen'),
  false,
  'playback should not start before buffered audio is published',
)
model.onBase64(0, 12000)
model.onBase64(12000, 12000)
model.onBase64(24000, 12000)
model.onBase64(36000, 12000)
equal(receivedAudioCount(), 0, 'output audio should stay hidden until 1.25 seconds are buffered')
model.onBase64(48000, 12000)
equal(receivedAudioCount(), 1, '1.25 seconds of output audio should start playback')
equal(postedMessages.at(-2)?.id, 'receiveAudio', 'buffered audio should be published before playback starts')
equal(postedMessages.at(-1)?.id, 'listen', 'playback should start after buffered audio is published')

postedMessages.length = 0
model['response.created']()
model.onBase64(48000, 12000)
model.parser = { copy() {}, done() {} }
model['response.done']()
equal(receivedAudioCount(), 1, 'a short response should be released before playback is marked done')
equal(postedMessages.at(-2)?.id, 'listen', 'a short response should start only after its audio is published')
equal(postedMessages.at(-1)?.id, 'speak', 'a short response should drain after playback starts')

postedMessages.length = 0
model['response.created']()
model.parser = { copy() {}, done() {} }
model['response.done']()
equal(
  postedMessages.some((message) => message.id === 'listen' || message.id === 'speak'),
  false,
  'an empty response should keep microphone input active instead of playing silence',
)
equal(postedMessages.at(-1)?.id, 'resume', 'an empty response should resume microphone input')

trace('ok\n')
Timer.set(() => {}, 1000)
