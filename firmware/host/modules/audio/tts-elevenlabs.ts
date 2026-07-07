/* eslint-disable prefer-const */

import ElevenLabsStreamer from 'elevenlabsstreamer'
import type AudioOut from 'pins/audioout'
import { runTTSPlayback } from 'tts-playback-lifecycle'
import type { TTSCompletion, TTSDoneListener, TTSPlaybackListener } from 'tts-types'

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

export class TTS {
  readonly telemetryName = 'elevenlabs'
  audio?: AudioOut
  onPlayed?: TTSPlaybackListener
  onDone?: TTSDoneListener
  token: string
  model: string
  voice: string
  latency: number
  format: string
  voice_settings?: voiceSettings
  volume: number
  streaming: boolean
  constructor(props: TTSProperty) {
    this.onPlayed = props.onPlayed
    this.onDone = props.onDone
    this.streaming = false
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
        new ElevenLabsStreamer({
          key: this.token,
          voice: this.voice,
          model: this.model,
          latency: this.latency,
          format: this.format,
          voice_settings: this.voice_settings,
          text,
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
