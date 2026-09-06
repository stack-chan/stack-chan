/* eslint-disable prefer-const */

import type AudioOut from 'pins/audioout'
import { type PlaybackHttpOptions, playbackHttp, ttsJSONRequest } from 'tts-http-client'
import { runTTSPlayback } from 'tts-playback-lifecycle'
import { PlaybackProvider } from 'tts-playback-session'
import type { TTSCompletion, TTSDoneListener, TTSPlaybackListener } from 'tts-types'
import WavStreamer from 'wavstreamer'

declare const device: { network: { https: { client: PlaybackHttpOptions } } }

/* global trace, SharedArrayBuffer */

export type TTSProperty = {
  onPlayed?: TTSPlaybackListener
  onDone?: TTSDoneListener
  token: string
  model?: string
  voice?: string
  speed?: number
  instructions?: string
  volume?: number
}

export class TTS extends PlaybackProvider {
  audio?: AudioOut
  token: string
  model: string
  voice: string
  speed: number
  instructions: string
  volume: number
  constructor(props: TTSProperty) {
    super(props)
    this.token = props.token
    this.model = props.model ?? 'tts-1'
    this.voice = props.voice ?? 'alloy'
    this.speed = props.speed ?? 1
    this.instructions = props.instructions ?? ''
    this.volume = props.volume ?? 0.5
  }
  stream(text: string, volume?: number, callback?: TTSCompletion): void {
    runTTSPlayback(this, callback, (lifecycle) => {
      const audio = lifecycle.openAudio({ streams: 1, bitsPerSample: 16, sampleRate: 24000 }, volume ?? this.volume)
      lifecycle.attach(
        new WavStreamer({
          http: playbackHttp(lifecycle, device.network.https.client),
          host: 'api.openai.com',
          port: 443,
          path: '/v1/audio/speech',
          request: ttsJSONRequest(
            lifecycle,
            {
              input: text,
              model: this.model,
              voice: this.voice,
              speed: this.speed,
              instructions: this.instructions,
              response_format: 'wav',
            },
            [['Authorization', `Bearer ${this.token}`]],
          ),
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
    })
  }
}
