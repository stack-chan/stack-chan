import { TTS } from 'tts-elevenlabs'
import Timer from 'timer'

const token = 'YOUR_API_KEY_HERE'
const tts = new TTS({
  token,
  onPlayed: (num) => {
    trace(`played ${num}\n`)
  },
  onDone: () => {
    trace('done\n')
  }
})

async function main() {
  while (true) {
    await tts.stream('Hello. I am Stack-chan. Nice to meet you.')
    Timer.delay(2000)
  }
}

main()
