import MuseNative from 'muse-native'
import { createMuseVoiceConversation } from 'muse-voice'
import MuseVoiceCore from 'muse-voice-core'
import Preference from 'preference'

const core = new MuseVoiceCore()
const id = '00000000-0000-4000-8000-000000000001'
core.begin(id, 0)
const admission = core.admission(id)
trace(`MUSE: native import ready ${typeof MuseNative}; admission bytes=${admission.byteLength ?? admission.length}\n`)
trace(`MUSE: head ${JSON.stringify(core.head(200, 1000))}\n`)
const ready = core.event(JSON.stringify({ type: 'hatch.voice.session', call_id: id, session_id: 'test-session' }), 2000)
if (ready.state !== 3 || !(ready.actions & 32)) throw new Error('core admission failed')
const up = core.uplink(new ArrayBuffer(1280), 42000)
if (!up.line || up.consumed !== 1280) throw new Error('core uplink failed')
trace(`MUSE: ready and PCM uplink passed ${up.consumed} bytes\n`)
const ending = core.action('hangUp', 50000)
if (!(ending.actions & 1)) throw new Error('core end-call missing')
trace('MUSE: explicit end-call action passed\n')
core.close()
trace('MUSE: core closed\n')
const conversation = createMuseVoiceConversation({})
if (conversation.capabilities.textInput || conversation.audio.input[0].sampleRate !== 16000)
  throw new Error('Conversation contract failed')
trace('MUSE: Conversation factory passed; no connection started\n')
const presence = {}
for (const [domain, expected] of [
  ['muse', ['host', 'vmId', 'token', 'appId', 'nodeId']],
  ['wifi', ['ssid', 'password']],
  [
    'homehub',
    ['ssid', 'password', 'access_token', 'refresh_token', 'auth_token', 'vm_url', 'noise_host', 'setup_complete'],
  ],
]) {
  const keys = Preference.keys(domain)
  for (const key of expected) presence[`${domain}.${key}`] = keys.includes(key)
}
trace(`MUSE: settings key presence only ${JSON.stringify(presence)}\n`)
