/* eslint-disable prefer-const */
import AudioOut from 'pins/audioout'
import ResourceStreamer from 'resourcestreamer'
import calculatePower from 'calculate-power'

/* global trace, SharedArrayBuffer */

export type TTSProperty = {
  onPlayed?: (number) => void
  onDone?: () => void
  sampleRate?: number
}

export class TTS {
  audio?: AudioOut
  onPlayed?: (number) => void
  onDone?: () => void
  streaming: boolean
  sampleRate: number
  constructor(props: TTSProperty) {
    this.onPlayed = props.onPlayed
    this.onDone = props.onDone
    this.streaming = false
    this.sampleRate = props.sampleRate ?? 11025
  }
  async stream(key: string): Promise<void> {
    if (this.streaming) {
      throw new Error('already playing')
    }
    this.streaming = true
    const { onPlayed, onDone } = this
    return new Promise((resolve, reject) => {
      this.audio = new AudioOut({ streams: 1, sampleRate: this.sampleRate })
      const audio = this.audio
      const streamer = new ResourceStreamer({
        path: `${key}.maud`,
        audio: {
          out: audio,
          stream: 0,
          sampleRate: this.sampleRate,
        },
        onPlayed: (buffer) => {
          const power = calculatePower(buffer)
          this.onPlayed?.(power)
        },
        onReady(this: ResourceStreamer, state) {
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
          streamer?.close()
          this.audio?.close()
          this.audio = undefined
          reject(e)
        },
        onDone: () => {
          trace('DONE\n')
          this.streaming = false
          streamer?.close()
          this.audio?.close()
          this.audio = undefined
          onDone?.()
          resolve()
        },
      })
    })
  }
}
