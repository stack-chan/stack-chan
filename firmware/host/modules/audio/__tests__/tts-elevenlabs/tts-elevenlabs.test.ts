import config from 'mc/config'
import { TTS, type TTSProperty } from 'tts-elevenlabs'

const token = config.token ?? 'test-token'

const property: TTSProperty = {
  token,
  onPlayed: (num) => {
    trace(`played ${num}\n`)
  },
  onDone: () => {
    trace('done\n')
  },
}

const tts = new TTS(property)
void tts
trace('ok\n')
