/* eslint-disable prefer-const */

import type HTTPClient from 'embedded:network/http/client'
import calculatePower from 'calculate-power'
import { fetch } from 'fetch'
import MP3Streamer from 'mp3streamer'
import AudioOut from 'pins/audioout'
import type { TTSCompletion, TTSDoneListener, TTSPlaybackListener } from 'tts-types'
import { URL } from 'url'

/* global trace, SharedArrayBuffer */
declare const device: {
  network: {
    https: typeof HTTPClient.constructor & {
      io: typeof HTTPClient
      socket: unknown
      dns: unknown
    }
  }
}

export type TTSProperty = {
  onPlayed?: TTSPlaybackListener
  onDone?: TTSDoneListener
  token: string
  sampleRate?: number
  speakerId?: number
  volume?: number
}

export class TTS {
  audio?: AudioOut
  onPlayed?: TTSPlaybackListener
  onDone?: TTSDoneListener
  token: string
  streaming: boolean
  speakerId: number
  sampleRate?: number
  volume: number
  constructor(props: TTSProperty) {
    this.onPlayed = props.onPlayed
    this.onDone = props.onDone
    this.streaming = false
    this.speakerId = props.speakerId ?? 1
    this.token = props.token
    this.volume = props.volume ?? 0.5
  }

  async getQuery(text: string, speakerId = 1): Promise<string> {
    return fetch(
      encodeURI(`https://api.tts.quest/v3/voicevox/synthesis?key=${this.token}&text=${text}&speaker=${speakerId}`),
    )
      .then((response) => {
        if (response.status !== 200) {
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

  stream(key: string, volume?: number, callback?: TTSCompletion): void {
    if (this.streaming) {
      callback?.(new Error('already playing'))
      return
    }
    this.streaming = true

    const speakerId = this.speakerId
    this.getQuery(key, speakerId).then(
      (streamUrl) => {
        const url = new URL(streamUrl)
        const { onPlayed, onDone } = this

        this.audio = new AudioOut({ streams: 1, bitsPerSample: 16, sampleRate: this.sampleRate ?? 22050 })
        this.audio.enqueue(0, AudioOut.Volume, Math.round((volume ?? this.volume) * 256))
        const audio = this.audio
        const streamer = new MP3Streamer({
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
            streamer?.close()
            this.audio?.close()
            this.audio = undefined
            callback?.(e)
          },
          onDone: () => {
            trace('DONE\n')
            this.streaming = false
            streamer?.close()
            this.audio?.close()
            this.audio = undefined
            onDone?.()
            callback?.()
          },
        })
      },
      (error) => {
        this.streaming = false
        callback?.(new Error(`getQuery failed: ${error}`))
      },
    )
  }
}
