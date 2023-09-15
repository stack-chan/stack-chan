/* eslint-disable prefer-const */
import AudioOut from 'pins/audioout'
import ElevenLabsStreamer from 'elevenlabsstreamer'
import calculatePower from 'calculate-power'

/* global trace, SharedArrayBuffer */

declare const device: any

export type TTSProperty = {
  onPlayed: (number) => void
  onDone: () => void
  api_key: string
}

export class TTS {
  audio: AudioOut
  onPlayed: (number) => void
  onDone: () => void
  api_key: string
  streaming: boolean
  constructor(props: TTSProperty) {
    this.onPlayed = props.onPlayed
    this.onDone = props.onDone
    this.audio = new AudioOut({ streams: 1, bitsPerSample: 16, sampleRate: 44100 })
    this.api_key = props.api_key
  }
  async stream(key: string): Promise<void> {
    if (this.streaming) {
      throw new Error('already playing')
    }
    this.streaming = true

    const { onPlayed, onDone, audio } = this
    return new Promise((resolve, reject) => {
      let streamer = new ElevenLabsStreamer({
        key: this.api_key,
        voice: 'AZnzlk1XvdvUeBnXmlld',
        latency: 2,
        text: key,
        audio: {
          out: audio,
          stream: 0,
        },
        onPlayed(buffer) {
          const power = calculatePower(buffer)
          onPlayed?.(power)
        },
        onReady(state) {
          trace(`Ready: ${state}\n`)
          if (state) {
            audio.start()
          } else {
            audio.stop()
          }
        },
        onError: (e) => {
          trace('ERROR: ', e, '\n')
          this.streaming = false
          reject(e)
        },
        onDone: () => {
          trace('DONE\n')
          this.streaming = false
          streamer?.close()
          onDone?.()
          resolve()
        },
      })
    })
  }
}
