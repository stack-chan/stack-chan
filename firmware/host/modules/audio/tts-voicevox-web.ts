/* eslint-disable prefer-const */

import type HTTPClient from 'embedded:network/http/client'
import { fetch } from 'fetch'
import MP3Streamer from 'mp3streamer'
import type AudioOut from 'pins/audioout'
import { beginTTSPlayback } from 'tts-playback-lifecycle'
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
    const lifecycle = beginTTSPlayback(this, callback)
    if (!lifecycle) return

    const speakerId = this.speakerId
    this.getQuery(key, speakerId).then(
      (streamUrl) => {
        try {
          const url = new URL(streamUrl)
          const audio = lifecycle.openAudio(
            { streams: 1, bitsPerSample: 16, sampleRate: this.sampleRate ?? 22050 },
            volume ?? this.volume,
          )
          lifecycle.attach(
            new MP3Streamer({
              http: device.network.https,
              host: url.host,
              path: url.pathname,
              port: 443,
              audio: {
                out: audio,
                stream: 0,
              },
              onPlayed: lifecycle.onPlayed,
              onReady: lifecycle.onReady,
              onError: lifecycle.onError,
              onDone: lifecycle.onDone,
            }),
          )
        } catch (error) {
          lifecycle.fail(error)
        }
      },
      (error) => {
        lifecycle.fail(new Error(`getQuery failed: ${error}`))
      },
    )
  }
}
