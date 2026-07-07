/* eslint-disable prefer-const */

import type HTTPClient from 'embedded:network/http/client'
import type AudioOut from 'pins/audioout'
import { runTTSPlayback } from 'tts-playback-lifecycle'
import type { TTSCompletion, TTSDoneListener, TTSPlaybackListener } from 'tts-types'
import WavStreamer from 'wavstreamer'

/* global trace, SharedArrayBuffer */
declare const device: {
  network: {
    http: typeof HTTPClient.constructor & {
      io: typeof HTTPClient
      socket: unknown
      dns: unknown
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

export class TTS {
  readonly telemetryName = 'remote'
  audio?: AudioOut
  onPlayed?: TTSPlaybackListener
  onDone?: TTSDoneListener
  host: string
  port: number
  sampleRate: number
  volume: number
  streaming: boolean
  constructor(props: TTSProperty) {
    this.onPlayed = props.onPlayed
    this.onDone = props.onDone
    this.streaming = false
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
          http: device.network.http,
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
