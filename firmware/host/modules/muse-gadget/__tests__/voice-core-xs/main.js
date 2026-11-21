import MuseVoiceCore from 'muse-voice-core'
import { runBridgeIntegration } from 'bridge-integration'

function check(condition, label) {
  if (!condition) throw new Error(label)
}
function rejects(action, label) {
  let threw = false
  try {
    action()
  } catch {
    threw = true
  }
  check(threw, label)
}
const c = new MuseVoiceCore()
const id = '11111111-1111-4111-8111-111111111111'
check(c.begin(id, 0).state === 1, 'opening')
check(c.head(200, 10).state === 2, 'connecting')
const send = (event) => c.event(JSON.stringify(event), 100)
check(send({ type: 'hatch.voice.session', call_id: id, session_id: 'session' }).state === 3, 'live')
check(c.action('press', 101).gateFlush >= 0, 'press')
send({ type: 'input_audio_buffer.speech_started', item_id: 'item' })
let event = send({ type: 'hatch.voice.turn_started', submission_message_id: 'turn', item_id: 'item' })
check(event.activeTurns.length === 1 && event.activeTurns[0] === 'turn', 'active turn')
check(event.captionsAllowed, 'captions')
const pcm = new ArrayBuffer(1280)
const append = c.uplink(pcm, 200)
check(append.consumed > 0 && JSON.parse(append.line).type === 'input_audio_buffer.append', 'uplink framing')
event = send({
  type: 'continuous_audio_video.delta',
  response_id: 'reply',
  audio_delta: { audio_frames: 'AAAAAA==', format: { rate: 24000 }, num_channels: 1 },
})
check(event.gateVerdict === 2 && event.pcm instanceof ArrayBuffer, 'downlink decode')
for (let i = 0; i < 129; i++) {
  event = send({
    type: 'continuous_audio_video.delta',
    response_id: `reply-${i}`,
    audio_delta: { audio_frames: 'AAAAAA==' },
  })
}
check(event.gateFull && event.gateVerdict === 0, 'reply capacity fails closed')
event = send({ type: 'hatch.voice.turn_settled', response_message_id: 'turn' })
check(event.activeTurns.length === 0, 'settled turn')
rejects(() => c.event('{', 200), 'invalid json')
rejects(() => c.event('x'.repeat(32769), 200), 'bounded json')
rejects(() => c.uplink(new ArrayBuffer(3), 200), 'pcm alignment')
const admission = JSON.parse(c.admission(id))
check(admission.type === 'hatch.voice.call.start', 'admission')
const stopped = c.action('hangUp', 200)
check(stopped.actions & 1, 'explicit end call')
check(JSON.parse(c.endCallBody(1700000000000, 200)).call_id === id, 'end body')
c.action('endSent', 200)
c.action('endDone', 300)
c.action('mediaEnd', 400, true)
c.close()
c.close()
rejects(() => c.action('poll', 500), 'use after close')
const drain = new MuseVoiceCore()
drain.begin(id, 0)
drain.head(200, 1)
const dsend = (event) => drain.event(JSON.stringify(event), 2)
dsend({ type: 'hatch.voice.session', call_id: id, session_id: 'session' })
drain.action('press', 2)
dsend({ type: 'input_audio_buffer.speech_started', item_id: 'item' })
dsend({ type: 'hatch.voice.turn_started', submission_message_id: 'turn', item_id: 'item' })
const tail = { type: 'continuous_audio_video.delta', response_id: 'reply', audio_delta: { audio_frames: 'AAAAAA==' } }
dsend(tail)
dsend({ type: 'conversation.item.added', item: { type: 'session_control', name: 'stop' } })
check(dsend(tail).pcm instanceof ArrayBuffer, 'stop permits tail before half close')
drain.action('endSent', 3)
drain.action('endDone', 4)
check(!dsend(tail).pcm, 'half close rejects late tail')
drain.close()
trace('MUSE_VOICE_CORE_XS_PASS\n')
runBridgeIntegration().then(
  () => { globalThis.testResult = 'pass' },
  error => { globalThis.testResult = String(error) },
)
