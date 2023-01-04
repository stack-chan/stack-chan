/* eslint-disable prefer-const */
import AudioOut from 'pins/audioout'
import ResourceStreamer from 'resourcestreamer'
import calculatePower from 'calculate-power'

/* global trace, SharedArrayBuffer */

export type TTSProperty = {
  onPlayed: (number) => void
  onDone: () => void
} | {
  onPlayed: (number) => void
  onDone: () => void
  host: string
  port: number
}
let streamer;

export class TTS {
  streamer?: ResourceStreamer
  audio?: AudioOut
  onPlayed: (number) => void
  onDone: () => void
  constructor(props: TTSProperty) {
    this.onPlayed = props.onPlayed
    this.onDone = props.onDone
    this.audio = new AudioOut({ streams: 1 })
  }
  async stream(key: string): Promise<void> {
    const { onPlayed, onDone } = this
    return new Promise((resolve, reject) => {
      if (streamer != null) {
        reject(new Error('already playing'))
        return
      }
      streamer = new ResourceStreamer({
        path: `${key}.maud`,
        audio: {
          out: this.audio,
          stream: 0,
          sampleRate: 11025,
        },
        onPlayed(buffer) {
          const power = calculatePower(buffer)
          onPlayed?.(power)
        },
        onReady(state) {
          trace(`Ready: ${state}\n`)
          if (state) {
            this.audio.start()
          } else {
            this.audio.stop()
          }
        },
        onError(e) {
          trace('ERROR: ', e, '\n')
          streamer = undefined
          reject(new Error('unknown error occured'))
        },
        onDone() {
          trace('DONE\n')
          streamer?.close()
          streamer = undefined
          onDone?.()
          resolve()
        },
      })
    })
  }
}
