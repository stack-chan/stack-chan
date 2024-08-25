import config from 'mc/config'
import { TTS, TTSProperty } from 'tts-voicevox'
import Timer from 'timer'

const host = config.host
if (!host) throw new Error('host is missing.')

const property: TTSProperty = {
  host,
  port: 50021,
  sampleRate: 11025,
  speakerId: 1,
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
