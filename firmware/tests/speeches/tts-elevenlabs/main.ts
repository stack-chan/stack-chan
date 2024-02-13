import { TTS, TTSProperty } from 'tts-elevenlabs'
import Timer from 'timer'

const token = 'YOUR_API_KEY_HERE'
const property: TTSProperty = {
  token,
  onPlayed: (num) => {
    trace(`played ${num}\n`)
  },
  onDone: () => {
    trace('done\n')
  }
}

const tts = new TTS({ property })

while (true) {
  await tts.stream('Hello. I am Stack-chan. Nice to meet you.')
  Timer.delay(2000)
}
