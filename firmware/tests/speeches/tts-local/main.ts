import Timer from 'timer'
import { TTS } from 'tts-local'

const tts = new TTS({
  onPlayed: (num) => {
    trace(`played ${num}\n`)
  },
  onDone: () => {
    trace('done\n')
  },
})

while (true) {
  await tts.stream('wilhelm-scream')
  Timer.delay(2000)
}
