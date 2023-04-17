/* eslint-disable prefer-const */
import AudioOut from 'pins/audioout'
import WavStreamer from 'wavstreamer'
import calculatePower from 'calculate-power'

/* global trace, SharedArrayBuffer */

declare const device: any

export type TTSProperty = {
  onPlayed: (number) => void
  onDone: () => void
  host: string
  port: number
  sampleRate?: number
}
let streamer

export class TTS {
  streamer?: WavStreamer
  audio?: AudioOut
  onPlayed: (number) => void
  onDone: () => void
  host: string
  port: number
  constructor(props: TTSProperty) {
    this.onPlayed = props.onPlayed
    this.onDone = props.onDone
    this.audio = new AudioOut({ streams: 1, sampleRate: props.sampleRate ?? 24000 })
    this.host = props.host
    this.port = props.port
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
        host: this.host,
        path: key,
        port: this.port,
        bufferDuration: 600,
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
