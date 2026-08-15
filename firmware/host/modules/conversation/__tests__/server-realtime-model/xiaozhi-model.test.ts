import OpusDecoder from 'stackchanOpusDecoder'
import OpusEncoder from 'stackchanOpusEncoder'
import { postedMessages, sentBinary, sentJSON } from 'stackchanServerChatWebSocketWorker'
import XiaozhiModel, { parseWebSocketEndpoint } from 'stackchanXiaozhiModel'
import { equal } from 'testing/assert'
import Timer from 'timer'

trace('=== xiaozhi-model test ===\n')

const localEndpoint = parseWebSocketEndpoint(
  'ws://192.168.7.140:8787/device/v1/realtime?device_id=core-s3&client_id=client-1',
)
equal(localEndpoint.secure, false, 'a LAN websocket endpoint should use cleartext')
equal(localEndpoint.host, '192.168.7.140', 'endpoint host should be parsed')
equal(localEndpoint.port, 8787, 'endpoint port should be parsed')

const connection = {
  barrier: new Int32Array(new SharedArrayBuffer(4 * Int32Array.BYTES_PER_ELEMENT)),
  inputBuffer: new SharedArrayBuffer(2048),
  outputBuffer: new SharedArrayBuffer(2048),
}
const rejected = new XiaozhiModel({ inputSampleRate: 16000, outputSampleRate: 24000 })
rejected.configure({ providerID: 'https://relay.example.test/device/v1/realtime' })
rejected.connect(connection)
equal(postedMessages[0]?.string, 'ChatService endpoint must use ws:// or wss://')
postedMessages.length = 0
rejected.configure({
  providerID: 'ws://relay.example.test/device/v1/realtime?device_id=core-s3&client_id=client-1',
  apiKey: 'test-token',
})
rejected.connect(connection)
equal(postedMessages[0]?.string, 'ChatService Bearer authentication over ws:// is restricted to trusted local networks')
postedMessages.length = 0

const model = new XiaozhiModel({ inputSampleRate: 16000, outputSampleRate: 24000 })
model.configure({
  providerID: 'wss://relay.example.test/device/v1/realtime?device_id=core-s3&client_id=client-1',
  apiKey: 'test-token',
  modelID: 'agent-1',
})
equal(model.headers[0]?.[0], 'Authorization', 'authentication should use a header')
equal(model.headers[1]?.[0], 'Protocol-Version', 'XiaoZhi protocol v1 should be declared')
equal(model.headers[2]?.[1], 'core-s3', 'Device-Id should come from the endpoint identity')
equal(model.headers[3]?.[1], 'client-1', 'Client-Id should come from the endpoint identity')
model.connect(connection)
model.onOpen()
equal(sentJSON[0]?.type, 'hello', 'opening should send the XiaoZhi hello')
equal(sentJSON[0]?.version, 1, 'hello should select protocol v1')
equal(sentJSON[0]?.agent_id, 'agent-1', 'hello should carry the selected stack-chan agent')
equal(sentJSON[0]?.audio_params?.format, 'opus', 'hello should negotiate Opus')
equal(sentJSON[0]?.audio_params?.sample_rate, 16000, 'microphone Opus should use 16 kHz')
equal(sentJSON[0]?.audio_params?.frame_duration, 60, 'microphone Opus should use 60 ms frames')

model.hello({
  type: 'hello',
  version: 1,
  transport: 'websocket',
  session_id: 'session-1',
  audio_params: { format: 'opus', sample_rate: 24000, channels: 1, frame_duration: 20 },
})
equal(OpusEncoder.instances.length, 1, 'server hello should create one encoder')
equal(OpusDecoder.instances.length, 1, 'server hello should create one decoder')
equal(OpusDecoder.instances[0]?.sampleRate, 24000, 'decoder should use the negotiated sample rate')
equal(OpusDecoder.instances[0]?.frameDuration, 20, 'decoder should use the negotiated frame duration')
equal(postedMessages[0]?.id, 'configureAudio', 'AudioOut should receive the negotiated sample rate')
equal(postedMessages[1]?.id, 'connected', 'a valid server hello should connect the chat')
equal(sentJSON[1]?.type, 'listen', 'a valid server hello should start listening')
equal(sentJSON[1]?.mode, 'auto', 'server VAD should use XiaoZhi auto listening mode')

const input = new Uint8Array(connection.inputBuffer)
input.set([1, 2, 3, 4, 5], 0)
input.set([6, 7, 8, 9, 10, 11, 12], 20)
model.sendAudio({ offset: 0, size: 5 })
equal(sentBinary.length, 0, 'partial PCM should wait for a complete 60 ms frame')
model.sendAudio({ offset: 20, size: 7 })
equal(OpusEncoder.instances[0]?.inputs.length, 1, 'one complete PCM frame should be encoded once')
equal(sentBinary.length, 1, 'one Opus packet should be one binary WebSocket message')
equal(sentBinary[0]?.data.byteLength, 3, 'only the encoded packet bytes should be sent')

const opusPacket = Uint8Array.of(0x6b, 0x43, 0x06, 0x9b)
model.read(opusPacket.slice(0, 2).buffer, { binary: true, more: true })
equal(OpusDecoder.instances[0]?.inputs.length, 0, 'a fragmented packet should wait for its final fragment')
model.read(opusPacket.slice(2).buffer, { binary: true, more: false })
equal(OpusDecoder.instances[0]?.inputs.length, 1, 'one WebSocket message should decode as one Opus packet')
equal(model.parser.copied[0]?.byteLength, 960, '20 ms of 24 kHz PCM should reach AudioOut')

model.stt({ type: 'stt', text: 'こんにちは' })
model.tts({ type: 'tts', state: 'start' })
model.tts({ type: 'tts', state: 'sentence_start', text: 'こんにちは！' })
model.tts({ type: 'tts', state: 'stop' })
equal(
  postedMessages.some((message) => message.id === 'receiveInputText'),
  true,
  'STT text should reach the UI',
)
equal(
  postedMessages.some((message) => message.id === 'listen'),
  true,
  'TTS start should switch to AudioOut',
)
equal(
  postedMessages.some((message) => message.text === 'こんにちは！'),
  true,
  'TTS text should reach the UI',
)
equal(model.parser.doneCount, 1, 'TTS stop should finish the playback stream')
equal(
  postedMessages.some((message) => message.id === 'speak'),
  true,
  'TTS stop should wait for playback drain',
)

const listenCount = sentJSON.length
model.listened()
equal(sentJSON.length, listenCount + 1, 'playback drain should start the next microphone turn')
equal(sentJSON[sentJSON.length - 1]?.session_id, 'session-1', 'events should retain the negotiated session')

model.close()
model.connect(connection)
model.hello({
  type: 'hello',
  version: 1,
  transport: 'websocket',
  session_id: 'session-2',
  audio_params: { format: 'opus', sample_rate: 24000, channels: 1, frame_duration: 20 },
})
equal(OpusEncoder.instances.length, 2, 'reconnecting should create a fresh encoder')
model.sendAudio({ offset: 0, size: 12 })
equal(OpusEncoder.instances[1]?.inputs.length, 1, 'reconnected audio should be encoded')

const invalid = new XiaozhiModel({ inputSampleRate: 16000, outputSampleRate: 24000 })
invalid.configure({
  providerID: 'wss://relay.example.test/device/v1/realtime?device_id=core-s3&client_id=client-2',
})
invalid.connect(connection)
invalid.hello({
  type: 'hello',
  version: 1,
  transport: 'websocket',
  session_id: 'bad',
  audio_params: { format: 'pcm', sample_rate: 24000, channels: 1, frame_duration: 20 },
})
equal(invalid.closed, true, 'invalid server negotiation should close the connection')

trace('ok\n')
Timer.set(() => {}, 1000)
