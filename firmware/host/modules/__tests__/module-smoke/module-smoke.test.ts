// Consolidated constructor smokes: each module only needs to prove it loads
// and constructs in XS, so they share one manifest instead of paying a full
// mcconfig build per module.
import config from 'mc/config'
import { NetworkService } from 'network-service'
import STT from 'stt-whisper'
import { equal } from 'testing/assert'
import { TTS as ElevenLabsTTS } from 'tts-elevenlabs'
import { TTS as LocalTTS } from 'tts-local'
import { TTS as OpenAITTS } from 'tts-openai'
import { TTS as StackchanVoiceTTS } from 'tts-stackchan-voice'
import { TTS as VoiceVoxTTS } from 'tts-voicevox'
import { TTS as VoiceVoxWebTTS } from 'tts-voicevox-web'

trace('=== module smoke test ===\n')

const token = (config.token as string) ?? 'test-token'
const host = (config.host as string) ?? '127.0.0.1'
const onPlayed = (num: number) => {
  trace(`played ${num}\n`)
}
const onDone = () => {
  trace('done\n')
}

void new LocalTTS({ onPlayed, onDone })
trace('smoke: tts-local\n')

void new ElevenLabsTTS({ token, onPlayed, onDone })
trace('smoke: tts-elevenlabs\n')

void new OpenAITTS({ token, onPlayed, onDone })
trace('smoke: tts-openai\n')

void new VoiceVoxTTS({ host, port: 50021, sampleRate: 24000, speakerId: 1, onPlayed, onDone })
trace('smoke: tts-voicevox\n')

void new VoiceVoxWebTTS({ token, onPlayed, onDone })
trace('smoke: tts-voicevox-web\n')

const stackchanVoice = new StackchanVoiceTTS({ onPlayed, onDone })
let stackchanVoiceCallbackCalled = false
stackchanVoice.stream('hello', undefined, (error) => {
  equal(String(error), 'Error: stackchan-voice is unavailable on this target')
  stackchanVoiceCallbackCalled = true
})
equal(stackchanVoiceCallbackCalled, true, 'unavailable stackchan-voice should report through its callback')
trace('smoke: tts-stackchan-voice unavailable\n')

void new STT({ apiKey: token })
trace('smoke: stt-whisper\n')

const service = new NetworkService({
  ssid: 'myssid',
  password: 'mypassword',
})
service.connect(
  () => {
    trace('smoke: network-service connected\n')
    trace('ok\n')
  },
  (message) => {
    trace(`error: ${message}\n`)
  },
)
