import AXP2101 from 'embedded:peripheral/Power/axp2101'
import readBatteryLevel from 'axp2101-battery-status'
import { getAxp2101Power } from 'axp2101-power-capture'
// Consolidated constructor smokes: each module only needs to prove it loads
// and constructs in XS, so they share one manifest instead of paying a full
// mcconfig build per module.
import { ChatService, createXiaozhiV1Connection } from 'chat'
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
let realtimeError = ''
try {
  new ChatService({
    connection: createXiaozhiV1Connection({
      endpoint: `ws://${host}/xiaozhi-v1`,
      deviceId: 'test-device',
      clientId: 'test-client',
    }),
  })
} catch (error) {
  realtimeError = String(error)
}
equal(
  realtimeError.includes('unavailable on this target'),
  true,
  'unsupported targets should reject the selected realtime protocol',
)
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
  },
  (message) => {
    trace(`error: ${message}\n`)
  },
)

// Exercise the actual SDK peripheral through the same hooks used by CoreS3.
const registers = new Map<number, number>()
class PowerBus {
  readUint8(address: number) {
    return registers.get(address) ?? 0
  }
  writeUint8(address: number, value: number) {
    registers.set(address, value)
  }
}
const power = new AXP2101({ sensor: { io: PowerBus } })
power.writeUint8(0x00, 0x08)
power.writeUint8(0xa4, 75)
equal(getAxp2101Power(), power, 'capture the SDK peripheral instance')
equal(readBatteryLevel(), 75, 'read the battery through the captured SDK peripheral')
equal(power.readUint8(0xa4), 75, 'capture preserves register reads and writes')

trace('ok\n')
