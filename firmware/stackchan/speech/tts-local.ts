/* eslint-disable prefer-const */
import AudioOut from 'pins/audioout'
import ResourceStreamer from 'resourcestreamer'
import calculatePower from 'calculate-power'

/* global trace, SharedArrayBuffer */

export type TTSProperty =
  | {
      onPlayed: (number) => void
      onDone: () => void
      sampleRate?: number
    }
  | {
      onPlayed: (number) => void
      onDone: () => void
      host: string
      port: number
      sampleRate?: number
    }

export class TTS {
  streamer?: ResourceStreamer
  audio?: AudioOut
  onPlayed: (number) => void
  onDone: () => void
  constructor(props: TTSProperty) {
    this.onPlayed = props.onPlayed
    this.onDone = props.onDone
    this.audio = new AudioOut({ streams: 1, sampleRate: props.sampleRate ?? 11025 })
  }
  async stream(key: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.streamer != null) {
        reject(new Error('already playing'))
        return
      }
      const sampleRate = this.audio.sampleRate ?? 11025
      this.streamer = new ResourceStreamer({
        path: `${key}.maud`,
        audio: {
          out: this.audio,
          stream: 0,
          sampleRate,
        },
        onReady(this: ResourceStreamer, state) {
          trace(`Ready: ${state}\n`)
          if (state) {
            this.audio.start()
          } else {
            this.audio.stop()
          }
        },
        onPlayed: (buffer) => {
          const power = calculatePower(buffer)
          this.onPlayed?.(power)
        },
        onError: (e) => {
          trace('ERROR: ', e, '\n')
          this.streamer = undefined
          reject(new Error('unknown error occured'))
        },
        onDone: () => {
          trace('DONE\n')
          this.streamer?.close()
          this.streamer = undefined
          this.onDone?.()
          resolve()
        },
      })
    })
  }
}
