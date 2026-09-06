/* eslint-disable prefer-const */

import MP3Streamer from 'mp3streamer'
import type AudioOut from 'pins/audioout'
import { type PlaybackHttpOptions, playbackHttp, ttsJSONRequest } from 'tts-http-client'
import { runTTSPlayback } from 'tts-playback-lifecycle'
import { PlaybackProvider } from 'tts-playback-session'
import type { TTSCompletion, TTSDoneListener, TTSPlaybackListener } from 'tts-types'

declare const device: { network: { https: { client: PlaybackHttpOptions } } }

/* global trace, SharedArrayBuffer */

type voiceSettings = {
  similarity_boost: number
  stability: number
  style?: number
  use_speaker_boost?: boolean
}

export type TTSProperty = {
  onPlayed?: TTSPlaybackListener
  onDone?: TTSDoneListener
  token: string
  voice?: string
  latency?: number
  format?: string
  model?: string
  voice_settings?: voiceSettings
  volume?: number
}

export class TTS extends PlaybackProvider {
  audio?: AudioOut
  token: string
  model: string
  voice: string
  latency: number
  format: string
  voice_settings?: voiceSettings
  volume: number
  constructor(props: TTSProperty) {
    super(props)
    this.token = props.token
    this.latency = props.latency ?? 2
    this.format = props.format ?? 'mp3_44100_64'
    this.model = props.model ?? 'eleven_monolingual_v1'
    this.voice = props.voice ?? 'AZnzlk1XvdvUeBnXmlld'
    this.voice_settings = props.voice_settings
    this.volume = props.volume ?? 0.5
  }
  stream(text: string, volume?: number, callback?: TTSCompletion): void {
    runTTSPlayback(this, callback, (lifecycle) => {
      const audio = lifecycle.openAudio({ streams: 1, bitsPerSample: 16, sampleRate: 44100 }, volume ?? this.volume)
      lifecycle.attach(
        new MP3Streamer({
          http: playbackHttp(lifecycle, device.network.https.client),
          host: 'api.elevenlabs.io',
          port: 443,
          path: `/v1/text-to-speech/${encodeURIComponent(this.voice)}/stream?optimize_streaming_latency=${encodeURIComponent(this.latency)}&output_format=${encodeURIComponent(this.format)}`,
          request: ttsJSONRequest(
            lifecycle,
            {
              text,
              model_id: this.model,
              voice_settings: this.voice_settings ?? { stability: 0, similarity_boost: 0 },
            },
            [
              ['accept', 'audio/mpeg'],
              ['xi-api-key', this.token],
            ],
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
