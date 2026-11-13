/* eslint-disable prefer-const */

import type { HTTPClientProvider } from 'embedded:network/http/client'
import type AudioOut from 'pins/audioout'
import { runSpeechPlayback } from 'speech-playback-lifecycle'
import type { SpeechCompletion, SpeechDoneListener, SpeechPlaybackListener } from 'speech-playback-types'
import WavStreamer from 'wavstreamer'

/* global trace, SharedArrayBuffer */
declare const device: {
  network: {
    http: {
      client: HTTPClientProvider
    }
  }
}

export type SpeechPlaybackOptions = {
  onPlayed?: SpeechPlaybackListener
  onDone?: SpeechDoneListener
  host: string
  port: number
  sampleRate?: number
  volume?: number
}

export class SpeechPlayback {
  audio?: AudioOut
  onPlayed?: SpeechPlaybackListener
  onDone?: SpeechDoneListener
  host: string
  port: number
  sampleRate: number
  volume: number
  streaming: boolean
  constructor(props: SpeechPlaybackOptions) {
    this.onPlayed = props.onPlayed
    this.onDone = props.onDone
    this.streaming = false
    this.host = props.host
    this.port = props.port
    this.sampleRate = props.sampleRate ?? 24000
    this.volume = props.volume ?? 0.5
  }
  /** Stream remote speech and report playback completion through the optional callback. */
  stream(key: string, volume?: number, callback?: SpeechCompletion): void {
    runSpeechPlayback(this, callback, (lifecycle) => {
      const audio = lifecycle.openAudio({ streams: 1, sampleRate: this.sampleRate }, volume ?? this.volume)
      lifecycle.attach(
        new WavStreamer({
          http: device.network.http.client,
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
