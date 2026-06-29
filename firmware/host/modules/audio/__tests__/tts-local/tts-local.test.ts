import { TTS } from 'tts-local'

const tts = new TTS({
  onPlayed: (num) => {
    trace(`played ${num}\n`)
  },
  onDone: () => {
    trace('done\n')
  },
})

void tts
trace('ok\n')
