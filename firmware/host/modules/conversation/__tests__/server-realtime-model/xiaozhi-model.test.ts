import OpusDecoder from 'stackchanOpusDecoder'
import OpusEncoder from 'stackchanOpusEncoder'
import { postedMessages, sentBinary, sentJSON } from 'stackchanServerChatWebSocketWorker'
import XiaozhiModel, { parseWebSocketEndpoint } from 'xiaozhiV1Model'
import { equal } from 'testing/assert'

trace('=== xiaozhi-model test ===\n')

function resetTransport() {
  postedMessages.length = 0
  sentBinary.length = 0
  sentJSON.length = 0
}

const localEndpoint = parseWebSocketEndpoint('ws://192.168.7.140:8787/xiaozhi-v1')
equal(localEndpoint.secure, false, 'a LAN websocket endpoint should use cleartext')
equal(localEndpoint.host, '192.168.7.140', 'endpoint host should be parsed')
equal(localEndpoint.port, 8787, 'endpoint port should be parsed')

const connection = {
  barrier: new Int32Array(new SharedArrayBuffer(4 * Int32Array.BYTES_PER_ELEMENT)),
  inputBuffer: new SharedArrayBuffer(2048),
  outputBuffer: new SharedArrayBuffer(2048),
}
const pcmRing = new SharedArrayBuffer(1920 * 32 + 2)
const pcmRingState = new SharedArrayBuffer(4 * Int32Array.BYTES_PER_ELEMENT)

resetTransport()
const rejected = new XiaozhiModel({ inputSampleRate: 16000, outputSampleRate: 24000 })
rejected.configure({
  configuration: {
    protocol: 'xiaozhi-v1',
    endpoint: 'ws://relay.example.test/xiaozhi-v1',
    authentication: { bearerToken: 'test-token' },
    identity: { deviceId: 'core-s3', clientId: 'client-1' },
  },
})
rejected.connect(connection)
equal(
  postedMessages[0]?.string,
  'ChatService Bearer authentication over ws:// is restricted to trusted local networks',
  'public cleartext bearer auth should fail',
)

resetTransport()
const mdnsRejected = new XiaozhiModel({ inputSampleRate: 16000, outputSampleRate: 24000 })
mdnsRejected.configure({
  configuration: {
    protocol: 'xiaozhi-v1',
    endpoint: 'ws://stackchan.local/xiaozhi-v1',
    authentication: { bearerToken: 'test-token' },
    identity: { deviceId: 'core-s3', clientId: 'client-1' },
  },
})
mdnsRejected.connect(connection)
equal(
  postedMessages[0]?.string,
  'ChatService Bearer authentication over ws:// is restricted to trusted local networks',
  'mDNS names must not widen cleartext bearer trust',
)

resetTransport()
const injectedIdentity = new XiaozhiModel({ inputSampleRate: 16000, outputSampleRate: 24000 })
injectedIdentity.configure({
  configuration: {
    protocol: 'xiaozhi-v1',
    endpoint: 'wss://relay.example.test/xiaozhi-v1',
    identity: { deviceId: 'core-s3\r\nInjected: true', clientId: 'client-1' },
  },
})
injectedIdentity.connect(connection)
equal(
  postedMessages[0]?.string,
  'XiaoZhi device identity contains invalid header characters',
  'identity header injection should fail',
)

resetTransport()
const injectedToken = new XiaozhiModel({ inputSampleRate: 16000, outputSampleRate: 24000 })
injectedToken.configure({
  configuration: {
    protocol: 'xiaozhi-v1',
    endpoint: 'wss://relay.example.test/xiaozhi-v1',
    authentication: { bearerToken: 'token\r\nInjected: true' },
    identity: { deviceId: 'core-s3', clientId: 'client-1' },
  },
})
injectedToken.connect(connection)
equal(
  postedMessages[0]?.string,
  'XiaoZhi Bearer token contains invalid header characters',
  'Bearer header injection should fail',
)

resetTransport()
const reserved = new XiaozhiModel({ inputSampleRate: 16000, outputSampleRate: 24000 })
reserved.configure({
  configuration: {
    protocol: 'xiaozhi-v1',
    endpoint: 'wss://relay.example.test/xiaozhi-v1',
    identity: { deviceId: 'core-s3', clientId: 'client-1' },
    helloExtension: { type: 'custom' },
  },
})
reserved.connect(connection)
equal(postedMessages[0]?.string.includes('cannot override type'), true, 'reserved hello fields should fail')

resetTransport()
const model = new XiaozhiModel({ inputSampleRate: 16000, outputSampleRate: 24000 })
const tool = {
  name: 'set_emotion',
  description: 'Set the face emotion',
  parameters: {
    type: 'object',
    properties: { emotion: { type: 'string' } },
    required: ['emotion'],
  },
}
model.configure({
  configuration: {
    protocol: 'xiaozhi-v1',
    endpoint: 'wss://relay.example.test/xiaozhi-v1',
    authentication: { bearerToken: 'test-token' },
    identity: { deviceId: 'core-s3', clientId: 'client-1' },
    helloExtension: { vendor_agent: 'agent-1' },
    listeningMode: 'manual',
    features: { mcp: true, aec: true, glyph_push: true },
    mcp: { serverInfo: { name: 'stack-chan', version: 'test' } },
  },
  functions: [tool],
  pcmRing,
  pcmRingState,
})
equal(model.headers[0]?.[0], 'Authorization', 'authentication should use a header')
equal(model.headers[1]?.[0], 'Protocol-Version', 'protocol version should be declared')
equal(model.headers[2]?.[1], 'core-s3', 'Device-Id should use structured identity')
equal(model.headers[3]?.[1], 'client-1', 'Client-Id should use structured identity')
model.connect(connection)
model.onOpen()
equal(sentJSON[0]?.type, 'hello', 'opening should send hello')
equal(sentJSON[0]?.vendor_agent, 'agent-1', 'vendor hello extensions should reach the wire')
equal(sentJSON[0]?.features?.mcp, true, 'MCP capability should be advertised')
equal(sentJSON[0]?.features?.aec, true, 'AEC capability should be advertised')
equal(sentJSON[0]?.features?.glyph_push, undefined, 'glyph push must remain unadvertised')

model.onJSON({
  type: 'hello',
  version: 1,
  transport: 'websocket',
  session_id: 'session-1',
  audio_params: { format: 'opus', sample_rate: 24000, channels: 1, frame_duration: 20 },
})
equal(OpusDecoder.instances.length > 0, true, 'server hello should create a decoder')
const decoder = OpusDecoder.instances[OpusDecoder.instances.length - 1]
const encoder = OpusEncoder.instances[OpusEncoder.instances.length - 1]
equal(encoder.attachedRing?.data, pcmRing, 'hello should attach the shared PCM ring')
equal(encoder.attachedRing?.state, pcmRingState, 'hello should attach the PCM ring state')
equal(decoder.sampleRate, 24000, 'decoder should use negotiated sample rate')
equal(decoder.frameDuration, 20, 'decoder should use negotiated frame duration')
equal(
  postedMessages.some((message) => message.id === 'connected'),
  true,
  'valid hello should connect',
)
equal(sentJSON[1]?.type, 'listen', 'valid hello should start listening')
equal(sentJSON[1]?.mode, 'manual', 'configured listening mode should be used')

const eventStart = sentJSON.length
model.stopListening()
model.startListening({ mode: 'realtime' })
model.detectWakeWord({ text: 'Hi Stack-chan' })
model.abort({ reason: 'wake_word_detected' })
equal(sentJSON[eventStart]?.state, 'stop', 'listen stop should be implemented')
equal(sentJSON[eventStart + 1]?.mode, 'realtime', 'listen start should accept mode')
equal(sentJSON[eventStart + 2]?.state, 'detect', 'wake-word detect should be implemented')
equal(sentJSON[eventStart + 2]?.text, 'Hi Stack-chan', 'wake-word text should be preserved')
equal(sentJSON[eventStart + 3]?.type, 'abort', 'abort should be implemented')
model.startListening({ mode: 'manual' })

encoder.packets.push(Uint8Array.of(0xf8, 0xff, 0xfe))
model.flushEncodedAudio()
equal(sentBinary.length, 1, 'one Opus packet should be one binary message')

encoder.packets.push(Uint8Array.of(0x01), Uint8Array.of(0x02))
model.flushEncodedAudio()
equal(sentBinary.length, 3, 'flush should drain every queued Opus packet')

model.onJSON({ type: 'tts', state: 'start' })
const opusPacket = Uint8Array.of(0x6b, 0x43, 0x06, 0x9b)
model.read(opusPacket.slice(0, 2).buffer, { binary: true, more: true })
model.read(opusPacket.slice(2).buffer, { binary: true, more: false })
equal(decoder.inputs.length, 1, 'fragmented binary message should decode once')
equal(model.parser.copied[0]?.byteLength, 960, 'decoded PCM should reach AudioOut')

const glyphPush = {
  v: 1,
  bundle: 'noto-v1',
  size: 20,
  bpp: 1,
  glyphs: [{ codepoint: 0x20bb7, adv_w: 320, box_w: 1, box_h: 1, ofs_x: 0, ofs_y: 0, bitmap: 'AA==' }],
}
model.onJSON({ type: 'stt', text: '𠮷', glyph_push: glyphPush })
model.onJSON({ type: 'llm', emotion: 'happy', text: '😀' })
model.onJSON({ type: 'tts', state: 'sentence_start', text: '𠮷野家', glyph_push: glyphPush })
model.onJSON({ type: 'tts', state: 'stop' })
equal(
  postedMessages.some((message) => message.id === 'receiveInputText' && message.text === '𠮷'),
  true,
)
equal(
  postedMessages.some((message) => message.id === 'receiveEmotion' && message.emotion === 'happy'),
  true,
)
equal(
  postedMessages.filter((message) => message.id === 'receiveGlyphPush').length,
  2,
  'glyph payloads should be forwarded',
)
equal(model.parser.doneCount, 1, 'TTS stop should finish playback')

const closedBeforeAlert = model.closed
model.onJSON({ type: 'alert', status: 'Warning', message: 'Battery low', emotion: 'sad' })
equal(
  postedMessages.some((message) => message.id === 'receiveAlert' && message.message === 'Battery low'),
  true,
)
equal(model.closed, closedBeforeAlert, 'alert must not close the connection')
model.onJSON({ type: 'system', command: 'reboot' })
equal(
  postedMessages.some((message) => message.id === 'receiveSystemCommand' && message.command === 'reboot'),
  true,
)
model.onJSON({ type: 'custom', payload: { value: 1 } })
equal(
  postedMessages.some((message) => message.id === 'receiveCustomEvent'),
  true,
)
model.onJSON({ type: 'vendor_extension', value: 1 })
equal(
  postedMessages.some((message) => message.id === 'receiveUnknownEvent'),
  true,
)
model.onJSON({ type: 'stt', text: 123 })
equal(
  postedMessages.some((message) => message.id === 'protocolWarning'),
  true,
  'malformed non-hello events warn',
)
const inputEventsBeforeMismatch = postedMessages.filter((message) => message.id === 'receiveInputText').length
model.onJSON({ type: 'stt', session_id: 'another-session', text: 'must be ignored' })
equal(
  postedMessages.filter((message) => message.id === 'receiveInputText').length,
  inputEventsBeforeMismatch,
  'events for a different session should be ignored',
)
equal(
  postedMessages.some((message) => message.id === 'protocolWarning' && /mismatched session_id/.test(message.string)),
  true,
  'session mismatches should be observable',
)

sentJSON.length = 0
model.onJSON({ type: 'mcp', payload: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} } })
equal(sentJSON[0]?.payload?.result?.protocolVersion, '2024-11-05', 'MCP initialize should respond')
equal(sentJSON[0]?.payload?.result?.serverInfo?.name, 'stack-chan', 'MCP server info should be configurable')
model.onJSON({ type: 'mcp', payload: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} } })
equal(sentJSON[1]?.payload?.result?.tools?.[0]?.name, 'set_emotion', 'MCP tools/list should expose tools')
model.onJSON({
  type: 'mcp',
  payload: {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'set_emotion', arguments: { emotion: 'happy' } },
  },
})
equal(
  postedMessages.some((message) => message.id === 'receiveFunctionCall' && message.call === 'mcp:number:3'),
  true,
  'MCP tools/call should use the existing tool callback',
)
model.sendFunctionResult({ call: 'mcp:number:3', result: { ok: true } })
equal(sentJSON[2]?.payload?.id, 3, 'MCP tool result should preserve request id')
equal(sentJSON[2]?.payload?.result?.isError, false, 'MCP tool result should use MCP content shape')
model.onJSON({ type: 'mcp', payload: { jsonrpc: '2.0', id: 4, method: 'unknown/method' } })
equal(sentJSON[3]?.payload?.error?.code, -32601, 'unknown MCP requests should receive method-not-found')
model.onJSON({ type: 'mcp', payload: { jsonrpc: '2.0', method: 'notifications/test', params: { ok: true } } })
equal(
  postedMessages.some((message) => message.id === 'receiveMcpNotification'),
  true,
)
model.onJSON({ type: 'mcp', payload: { jsonrpc: '2.0', id: 99, result: { ok: true } } })
equal(
  postedMessages.some((message) => message.id === 'receiveMcpResponse'),
  true,
)
model.sendMcpMessage({ payload: { jsonrpc: '2.0', method: 'notifications/device', params: { ready: true } } })
equal(sentJSON[sentJSON.length - 1]?.type, 'mcp', 'outbound MCP notification should be wrapped')

model.sendText({ text: 'unsupported' })
equal(
  postedMessages.some((message) => message.id === 'protocolWarning' && /text input/.test(message.string)),
  true,
)

model.onJSON({ type: 'tts', state: 'start' })
postedMessages.length = 0
model.read(new Uint8Array(1000).buffer, { binary: true, more: true })
model.read(new Uint8Array(276).buffer, { binary: true, more: false })
equal(postedMessages[0]?.string, 'Opus packet exceeds 1275 bytes', 'oversized fragmented Opus should fail')

resetTransport()
const invalidHello = new XiaozhiModel({ inputSampleRate: 16000, outputSampleRate: 24000 })
invalidHello.configure({
  configuration: {
    protocol: 'xiaozhi-v1',
    endpoint: 'wss://relay.example.test/xiaozhi-v1',
    identity: { deviceId: 'core-s3', clientId: 'client-2' },
  },
})
invalidHello.connect(connection)
invalidHello.onJSON({
  type: 'hello',
  transport: 'websocket',
  audio_params: { format: 'pcm', sample_rate: 24000, channels: 1, frame_duration: 20 },
})
equal(postedMessages[0]?.id, 'failed', 'invalid hello should remain fatal')

resetTransport()
const repeatedHello = new XiaozhiModel({ inputSampleRate: 16000, outputSampleRate: 24000 })
repeatedHello.configure({
  configuration: {
    protocol: 'xiaozhi-v1',
    endpoint: 'wss://relay.example.test/xiaozhi-v1',
    identity: { deviceId: 'core-s3', clientId: 'client-repeated' },
  },
  pcmRing,
  pcmRingState,
})
repeatedHello.connect(connection)
const repeatedHelloEvent = {
  type: 'hello',
  version: 1,
  transport: 'websocket',
  session_id: 'session-repeated',
  audio_params: { format: 'opus', sample_rate: 24000, channels: 1, frame_duration: 20 },
}
repeatedHello.onJSON(repeatedHelloEvent)
const firstRepeatedDecoder = OpusDecoder.instances[OpusDecoder.instances.length - 1]
const firstRepeatedEncoder = OpusEncoder.instances[OpusEncoder.instances.length - 1]
repeatedHello.onJSON(repeatedHelloEvent)
equal(firstRepeatedDecoder.closed, true, 'a repeated hello should close the previous decoder')
equal(firstRepeatedEncoder.closed, true, 'a repeated hello should close the previous encoder')
const secondRepeatedDecoder = OpusDecoder.instances[OpusDecoder.instances.length - 1]
const secondRepeatedEncoder = OpusEncoder.instances[OpusEncoder.instances.length - 1]
repeatedHello.close()
equal(secondRepeatedDecoder.closed, true, 'close should release the active decoder')
equal(secondRepeatedEncoder.closed, true, 'close should release the active encoder')
