/* eslint-disable prefer-const */
import AudioOut from 'pins/audioout'
import WavStreamer from 'wavstreamer'
import calculatePower from 'calculate-power'

/* global device, trace, SharedArrayBuffer */

declare const device: any

export type TTSProperty = {
  onPlayed: (number) => void
  onDone: () => void
}
let streamer;

export class TTS {
  streamer?: WavStreamer
  audio?: AudioOut
  onPlayed: (number) => void
  onDone: () => void
  constructor(props: TTSProperty) {
    this.onPlayed = props.onPlayed
    this.onDone = props.onDone
    this.audio = new AudioOut({ streams: 1 })
  }
  async stream(key: string): Promise<void> {
    const { onPlayed, onDone, audio } = this
    return new Promise((resolve, reject) => {
      if (streamer != null) {
        reject(new Error('already playing'))
        return
      }
      streamer = new WavStreamer({
        http: device.network.http,
        host: '192.168.7.112',
        path: key,
        port: 8080,
        audio: {
          out: audio,
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
            audio.start()
          } else {
            audio.stop()
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
