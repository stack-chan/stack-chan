import MuseVoiceCore from 'muse-voice-core'
import { createMuseVoiceBridge } from 'voice-bridge'

function check(value, label) { if (!value) throw new Error(`integration: ${label}`) }
const encode = value => new Uint8Array(ArrayBuffer.fromString(value))
const decode = value => String.fromArrayBuffer(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength))
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }

export async function runBridgeIntegration() {
  let callback, capture, time = 0, sequence = 0, deviceGeneration = 0, nativeClosed = false
  const timers = new Map(), sent = [], events = [], played = []
  const callId = '22222222-2222-4222-8222-222222222222'
  const signal = { aborted: false, addEventListener() {}, removeEventListener() {} }
  const native = {
    start() {}, handshake() {}, receive: frame => frame,
    voiceRequest(stream, id, body) { sent.push({route: 'voice', stream, id, body: decode(body)}) },
    bodyChunk(stream, body, end) { sent.push({route: 'body', stream, body: decode(new Uint8Array(body)), end}) },
    endCall(stream, body) { sent.push({route: 'end', stream, body: decode(body)}) },
    resetStream() {}, close() { nativeClosed = true },
  }
  const media = {
    input: {},
    output: {
      begin(name, generation) { check(generation === deviceGeneration, 'generation ownership'); return {name} },
      async fence(generation) { check(generation > deviceGeneration, 'monotonic fence'); deviceGeneration = generation; return [] },
      async finish(outputId) { return {outputId, state: 'played'} },
    },
    media: { async connect(source, sink) { if (!source.speaker) capture = sink.write; return {done: Promise.resolve(), async close() {}} } },
  }
  const bridge = createMuseVoiceBridge({nodeId: 'test-device'}, {
    createCore: () => new MuseVoiceCore(), openNative(_, cb) {callback = cb; return native}, encode, decode,
    createPcmSink: (_, write) => ({write}),
    createPcmSource: () => ({output: {speaker: true}, async push(data) {played.push(data.slice())}, end() {}}),
    nowUs: () => time, wallMs: () => 1700000000000, callId: () => callId,
    setTimer(cb, delay) { const id = ++sequence; timers.set(id, {cb, delay}); return id }, clearTimer(id) {timers.delete(id)},
  })
  const opening = bridge.open({media, signal, onEvent: event => events.push(event)})
  await settle()
  callback(1)
  callback(2, new ArrayBuffer(0))
  check(JSON.parse(sent[0].body).type === 'hatch.voice.call.start', 'actual admission')
  check(sent[0].id === callId, 'matching admission identity')
  const line = value => callback(2, {stream: 1, kind: 3, body: encode(`${JSON.stringify(value)}\n`)})
  callback(2, {stream: 1, kind: 2, status: 200})
  line({type: 'hatch.voice.session', call_id: callId, session_id: 'session'})
  const call = await opening
  await call.setInputEnabled(true)
  const poll = at => {time = at; for (const [id, timer] of timers) if (timer.delay === 10) {timers.delete(id); timer.cb(); break} }
  time = 300000
  capture(new Uint8Array(1280))
  poll(300000)
  check(sent.some(s => s.body.includes('input_audio_buffer.append')), 'native uplink through bridge')
  await call.setInputEnabled(false)
  const beforeQuiet = sent.filter(s => s.body.includes('input_audio_buffer.append')).length
  poll(340000)
  poll(380000)
  check(sent.filter(s => s.body.includes('input_audio_buffer.append')).length > beforeQuiet, 'release silence endpointing')
  line({type: 'input_audio_buffer.speech_started', item_id: 'item'})
  line({type: 'hatch.voice.turn_started', submission_message_id: 'turn', item_id: 'item'})
  line({type: 'continuous_audio_video.delta', response_id: 'reply', audio_delta: {audio_frames: 'AAAAAA==', format: {rate: 24000}, num_channels: 1}})
  await settle()
  check(played.length > 0, 'native decoded audio reaches media')
  line({type: 'hatch.voice.turn_settled', response_message_id: 'turn'})
  check(events.some(e => e.type === 'turn.started' && e.turnId === 'turn'), 'native turn start mapping')
  check(events.some(e => e.type === 'turn.settled' && e.turnId === 'turn'), 'native settlement mapping')
  check(!events.some(e => e.type === 'output.playback'), 'settlement not PCM finality')
  const closing = call.close({mode: 'drain'})
  check(JSON.parse(sent.find(s => s.route === 'end').body).call_id === callId, 'native explicit end call')
  callback(2, {stream: 3, kind: 2, status: 200, end: true})
  callback(2, {stream: 1, kind: 3, end: true})
  const result = await closing
  check(result.remoteFinalization === 'confirmed' && nativeClosed, 'finalization and ownership release')
  check(events.some(e => e.type === 'output.playback'), 'drain receipt')
  trace('MUSE_VOICE_BRIDGE_NATIVE_XS_PASS\n')
}
