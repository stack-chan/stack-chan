import config from 'mc/config'
import { TTS, TTSProperty } from 'tts-voicevox-web'
import Timer from 'timer'

const token = config.token

if (!token || token == 'YOUR_API_KEY_HERE') throw new Error('API token is missing.')

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

while (true) {
  await tts.stream('こんにちは。私の名前はスタックちゃんです。よろしくね。')
  Timer.delay(2000)
}
