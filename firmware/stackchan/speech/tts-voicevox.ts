/* eslint-disable prefer-const */
import { Headers } from "fetch";

import AudioOut from 'pins/audioout'
import WavStreamer from 'wavstreamer'
import calculatePower from 'calculate-power'

/* global device, trace, SharedArrayBuffer */

declare const device: any

export type TTSProperty = {
  onPlayed: (number) => void
  onDone: () => void
  host: string
  port: number
}
let streaming: boolean;

export class TTS {
  audio: AudioOut
  onPlayed: (number) => void
  onDone: () => void
  // TODO: Add type definition for HTTPClient
  client: any
  host: string
  port: number
  constructor(props: TTSProperty) {
    this.onPlayed = props.onPlayed
    this.onDone = props.onDone
    this.audio = new AudioOut({ streams: 1, bitsPerSample: 16, sampleRate: 24000 })
    this.host = props.host
    this.port = props.port
  }
  async getQuery(text: string, speakerId: number = 1): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      let buffer
      let idx = 0
      const client = new device.network.http.io({
        ...device.network.http,
        host: this.host,
        port: this.port,
      })
      client.request({
        method: 'POST',
        path: encodeURI(`/audio_query?text=${text}&speaker=${speakerId}`),
        headers: new Map([['Content-Type', 'application/x-www-form-urlencoded']]),
        onHeaders(status, _headers) {
          if (status !== 200) {
            reject(`server returned ${status}`)
          }
        },
        onReadable(count) {
          if (buffer == null) {
            buffer = this.read(count)
          } else {
            buffer.concat(this.read(count))
          }
        },
        onDone() {
          client.close()
          resolve(buffer)
        },
      })
    })
  }
  async stream(key: string): Promise<void> {
    if (streaming) {
      throw new Error('already playing')
    }
    streaming = true
    const speakerId = 1
    const query = await this.getQuery(key, speakerId)
    const { onPlayed, onDone, audio } = this
    return new Promise(async (resolve, reject) => {
      let idx = 0
      let streamer = new WavStreamer({
        http: device.network.http,
        host: '192.168.7.112',
        path: encodeURI(`/synthesis?speaker=${speakerId}`),
        port: 50021,
        audio: {
          out: audio,
          stream: 0,
          sampleRate: 12000,
        },
        request: {
          method: 'POST',
          headers: new Headers([
            ['Content-Type', 'application/json'],
            ['Content-Length', `${query.byteLength}`],
          ]),
          // body: query
          onWritable(count) {
            // NOTE: No need to check buffer.length. ArrayBuffer#slice is safe to overrun
            this.write(query.slice(idx, idx + count))
            idx += count
          },
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
          streaming = false
          reject(new Error('unknown error occured'))
        },
        onDone() {
          trace('DONE\n')
          streaming = false
          streamer?.close()
          onDone?.()
          resolve()
        },
      })
    })
  }
}
