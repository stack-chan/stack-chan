import { TTS } from 'tts-elevenlabs'
const tts = new TTS({
	token: 'YOUR_API_KEY',
  onPlayed: (number) => {
    self.postMessage({ type: 'onPlayed', value: number })
  },
})

self.onmessage = async function (msg) {
  await tts.stream('Hello world')
  self.postMessage({
		type: 'onDone',
    value: null,
  })
}
