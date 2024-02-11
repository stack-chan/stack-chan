/* eslint-disable prefer-const */
import AudioOut from 'pins/audioout'
import MP3Streamer from 'mp3streamer'
import calculatePower from 'calculate-power'
import { fetch } from 'fetch'
import { URL } from 'url'

/* global trace, SharedArrayBuffer */

declare const device: any

export type TTSProperty = {
  onPlayed: (number) => void
  onDone: () => void
  token: string
  sampleRate?: number
  speakerId?: number
}

export class TTS {
  audio: AudioOut
  onPlayed: (number) => void
  onDone: () => void
  token: string
  streaming: boolean
  speakerId: number
  constructor(props: TTSProperty) {
    this.onPlayed = props.onPlayed
    this.onDone = props.onDone
    this.audio = new AudioOut({ streams: 1, bitsPerSample: 16, sampleRate: props.sampleRate ?? 22050 })
    this.speakerId = props.speakerId ?? 1
    this.token = props.token
  }

  async getQuery(text: string, speakerId = 1): Promise<string> {
    return fetch(
      encodeURI(`https://api.tts.quest/v3/voicevox/synthesis?key=${this.token}&text=${text}&speaker=${speakerId}`)
    )
      .then((response) => {
        if (response.status != 200) {
          throw new Error(`response error:${response.status}`)
        }
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
    const url = new URL(streamUrl)
    const { onPlayed, onDone, audio } = this

    return new Promise((resolve, reject) => {
      let streamer = new MP3Streamer({
        http: device.network.https,
        host: url.host,
        path: url.pathname,
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
