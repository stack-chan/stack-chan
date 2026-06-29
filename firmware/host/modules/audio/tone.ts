import AudioOut from 'pins/audioout'

export type ToneProperty = {
  volume?: number
}

export default class Tone {
  volume: number

  constructor(props: ToneProperty) {
    this.volume = props.volume ?? 0.5
  }
  async tone(hz: number, duration: number, volume?: number): Promise<void> {
    const audio = new AudioOut({
      streams: 1,
      sampleRate: 24000,
      bitsPerSample: 16,
    })
    return new Promise((resolve) => {
      audio.enqueue(0, AudioOut.Flush)
      audio.enqueue(0, AudioOut.Volume, Math.round((volume ?? this.volume) * 256))
      audio.enqueue(0, AudioOut.Tone, hz, (audio.sampleRate * duration) / 1000)
      audio.enqueue(0, AudioOut.Callback, 1)
      audio.start()

      audio.callback = (_id) => {
        audio.close()
        resolve()
      }
    })
  }
}
