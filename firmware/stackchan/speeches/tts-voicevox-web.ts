/* eslint-disable prefer-const */
import AudioOut from 'pins/audioout'
import MP3Streamer from "mp3streamer";
import calculatePower from 'calculate-power'
import { fetch } from 'fetch'
import Headers from 'headers'


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
  host: string
  port: number
  token: string
  streaming: boolean
  speakerId: number
  constructor(props: TTSProperty) {
    this.onPlayed = props.onPlayed
    this.onDone = props.onDone
    this.audio = new AudioOut({ streams: 1, bitsPerSample: 16, sampleRate: props.sampleRate ?? 22050 })
    this.speakerId = props.speakerId ?? 1
    this.token = props.token
    trace(`tts.token:${this.token}\n`)
  }

  async getQuery(text: string, speakerId = 1): Promise<string> {
    return fetch(encodeURI(`https://api.tts.quest/v3/voicevox/synthesis?key=${this.token}&text=${text}&speaker=${speakerId}`))
      .then((response) => {
        //return response.text()
        return response.json()
      })
      .then((data) => {
        trace(`isApiKeyValid: ${data.isApiKeyValid}\n`)
        trace(`mp3StreamingUrl: ${data.mp3StreamingUrl}\n`)
        return data.mp3StreamingUrl
      })
  }

  async stream(key: string): Promise<void> {
    if (this.streaming) {
      throw new Error('already playing')
    }
    this.streaming = true

    const speakerId = this.speakerId
    const streamUrl = await this.getQuery(key, speakerId).catch((error) => {
      throw new Error(`getQuery failed: ${error}`)
    })
    const { onPlayed, onDone, audio } = this

    return new Promise((resolve, reject) => {
      trace(`host: ${streamUrl.substring(8,24)}\n`)
      trace(`path: ${streamUrl.substring(24)}\n`)
      let streamer = new MP3Streamer({
        http: device.network.https,
        host: streamUrl.substring(8,24),
        path: streamUrl.substring(24),
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
