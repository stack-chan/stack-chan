/* eslint-disable prefer-const */
import AudioOut from 'pins/audioout'
import MP3Streamer from "mp3streamer";
import calculatePower from 'calculate-power'
import HTTPClient from 'embedded:network/http/client'
import { File } from 'file'
import config from 'mc/config'

import {Request} from 'http'
import SecureSocket from 'securesocket'

import { fetch, Headers } from 'fetch'

const QUERY_PATH = config.file.root + 'query.json'

/* global trace, SharedArrayBuffer */

declare const device: any

export type TTSProperty = {
  onPlayed: (number) => void
  onDone: () => void
  host: string
  port: number
  token: string
  sampleRate: number
  speakerId: number
}

export class TTS {
  audio: AudioOut
  onPlayed: (number) => void
  onDone: () => void
  // TODO: Add type definition for HTTPClient
  client: HTTPClient
  host: string
  port: number
  token: string
  streaming: boolean
  streamUrl: string
  speakerId: number
  constructor(props: TTSProperty) {
    this.onPlayed = props.onPlayed
    this.onDone = props.onDone
    this.audio = new AudioOut({ streams: 1, bitsPerSample: 16, sampleRate: 22050 })
    this.speakerId = props.speakerId ?? 1
    this.token = props.token
    trace(`tts.token:${this.token}\n`)
  }

  async getQuery(text: string, speakerId = 1): Promise<unknown> {
    return fetch(encodeURI(`https://api.tts.quest/v3/voicevox/synthesis?key=${this.token}&text=${text}&speaker=${speakerId}`))
      .then((response) => {
        //return response.text()
        return response.json()
      })
      .then((data) => {
        trace(`isApiKeyValid: ${data.isApiKeyValid}\n`)
        trace(`mp3StreamingUrl: ${data.mp3StreamingUrl}\n`)
        this.streamUrl = data.mp3StreamingUrl
        return data.mp3StreamingUrl
      })
      .catch((error) => {
        trace("error\n")
      })
  }

  async stream(key: string): Promise<void> {
    if (this.streaming) {
      throw new Error('already playing')
    }
    this.streaming = true

    const speakerId = this.speakerId
    await this.getQuery(key, speakerId)
    const { onPlayed, onDone, audio } = this

    return new Promise((resolve, reject) => {
      //trace(`host: ${this.streamUrl.substring(8,24)}\n`)
      //trace(`path: ${this.streamUrl.substring(24)}\n`)
      let streamer = new MP3Streamer({
        http: device.network.https,
        host: this.streamUrl.substring(8,24),
        path: this.streamUrl.substring(24),
        port: 443,
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
