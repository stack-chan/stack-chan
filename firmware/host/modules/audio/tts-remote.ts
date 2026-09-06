/* eslint-disable prefer-const */

import type AudioOut from 'pins/audioout'
import { type PlaybackHttpOptions, playbackHttp } from 'tts-http-client'
import { runTTSPlayback } from 'tts-playback-lifecycle'
import { PlaybackProvider } from 'tts-playback-session'
import type { TTSCompletion, TTSDoneListener, TTSPlaybackListener } from 'tts-types'
import WavStreamer from 'wavstreamer'

/* global trace, SharedArrayBuffer */
declare const device: {
  network: {
    http: {
      client: PlaybackHttpOptions
    }
  }
}

export type TTSProperty = {
  onPlayed?: TTSPlaybackListener
  onDone?: TTSDoneListener
  host: string
  port: number
  sampleRate?: number
  volume?: number
}

export class TTS extends PlaybackProvider {
  audio?: AudioOut
  host: string
  port: number
  sampleRate: number
  volume: number
  constructor(props: TTSProperty) {
    super(props)
    this.host = props.host
    this.port = props.port
    this.sampleRate = props.sampleRate ?? 24000
    this.volume = props.volume ?? 0.5
  }
  stream(key: string, volume?: number, callback?: TTSCompletion): void {
    runTTSPlayback(this, callback, (lifecycle) => {
      const audio = lifecycle.openAudio({ streams: 1, sampleRate: this.sampleRate }, volume ?? this.volume)
      lifecycle.attach(
        new WavStreamer({
          http: playbackHttp(lifecycle, device.network.http.client),
          host: this.host,
          path: key,
          port: this.port,
          bufferDuration: 600,
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
