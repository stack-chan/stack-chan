/* eslint-disable prefer-const */
import { Headers } from 'fetch'

import AudioOut from 'pins/audioout'
import WavStreamer from 'wavstreamer'
import calculatePower from 'calculate-power'
import HTTPClient from 'embedded:network/http/client'
import { File } from 'file'
import config from 'mc/config'

const QUERY_PATH = config.file.root + 'query.json'

/* global trace, SharedArrayBuffer */

declare const device: any

export type TTSProperty = {
  onPlayed: (number) => void
  onDone: () => void
  host: string
  port: number
}

export class TTS {
  audio: AudioOut
  onPlayed: (number) => void
  onDone: () => void
  // TODO: Add type definition for HTTPClient
  client: HTTPClient
  host: string
  port: number
  streaming: boolean
  file: File
  constructor(props: TTSProperty) {
    this.onPlayed = props.onPlayed
    this.onDone = props.onDone
    this.audio = new AudioOut({ streams: 1, bitsPerSample: 16, sampleRate: 24000 })
    this.host = props.host
    this.port = props.port
  }
  async getQuery(text: string, speakerId = 1): Promise<void> {
    return new Promise((resolve, reject) => {
      File.delete(QUERY_PATH)
      const file = new File(QUERY_PATH, true)
      const client = new device.network.http.io({
        ...device.network.http,
        host: this.host,
        port: this.port,
      })
      client.request({
        method: 'POST',
        path: encodeURI(`/audio_query?text=${text}&speaker=${speakerId}`),
        headers: new Map([['Content-Type', 'application/x-www-form-urlencoded']]),
        onHeaders(status) {
          if (status !== 200) {
            reject(`server returned ${status}`)
          }
        },
        onReadable(count) {
          file.write(this.read(count))
          // trace(`${count} bytes written. position: ${file.position}\n`)
        },
        onDone(_error) {
          file.close()
          client.close()
          resolve()
        },
      })
    })
  }
  async stream(key: string): Promise<void> {
    if (this.streaming) {
      throw new Error('already playing')
    }
    this.streaming = true
    const speakerId = 1
    await this.getQuery(key, speakerId)
    const { onPlayed, onDone, audio } = this
    const file = new File(QUERY_PATH)
    trace(`file opened. length: ${file.length}, position: ${file.position}`)
    return new Promise((resolve, reject) => {
      let idx = 0
      let streamer = new WavStreamer({
        http: device.network.http,
        host: this.host,
        port: this.port,
        path: encodeURI(`/synthesis?speaker=${speakerId}`),
        audio: {
          out: audio,
          stream: 0,
          sampleRate: 12000,
        },
        request: {
          method: 'POST',
          headers: new Headers([
            ['Content-Type', 'application/json'],
            ['Content-Length', `${file.length}`],
          ]),
          // body: query
          onWritable(count) {
            this.write(file.read(ArrayBuffer, count))
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
        onError: (e) => {
          file.close()
          trace('ERROR: ', e, '\n')
          this.streaming = false
          reject(e)
        },
        onDone: () => {
          file.close()
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
