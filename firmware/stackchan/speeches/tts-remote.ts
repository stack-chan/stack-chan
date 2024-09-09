/* eslint-disable prefer-const */
import AudioOut from 'pins/audioout'
import WavStreamer from 'wavstreamer'
import calculatePower from 'calculate-power'

/* global trace, SharedArrayBuffer */

declare const device: any

export type TTSProperty = {
  onPlayed?: (number) => void
  onDone?: () => void
  host: string
  port: number
  sampleRate?: number
}

export class TTS {
  streamer?: WavStreamer
  audio?: AudioOut
  onPlayed?: (number) => void
  onDone?: () => void
  host: string
  port: number
  streaming: boolean
  constructor(props: TTSProperty) {
    this.onPlayed = props.onPlayed
    this.onDone = props.onDone
    this.audio = new AudioOut({ streams: 1, sampleRate: props.sampleRate ?? 24000 })
    this.host = props.host
    this.port = props.port
  }
  async stream(key: string): Promise<void> {
    if (this.streaming) {
      throw new Error('already playing')
    }
    this.streaming = true
    const { onPlayed, onDone, audio } = this
    return new Promise((resolve, reject) => {
      let streamer = new WavStreamer({
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
          this.streaming = false
          reject(e)
        },
        onDone() {
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
