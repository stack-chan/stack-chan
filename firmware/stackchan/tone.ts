import AudioOut from 'pins/audioout'

export default class Tone {
  async tone(hz: number, duration: number): Promise<void> {
    const audio = new AudioOut({
      streams: 1,
      sampleRate: 24000,
      bitsPerSample: 16,
    })
    return new Promise((resolve) => {
      audio.enqueue(0, AudioOut.Flush)
      audio.enqueue(0, AudioOut.Volume, 100)
      audio.enqueue(0, AudioOut.Tone, hz, (audio.sampleRate * duration) / 1000)
      audio.enqueue(0, AudioOut.Callback, 1)
      audio.start()

      audio.callback = (id) => {
        audio.close()
        resolve()
      }
    })
  }
}
