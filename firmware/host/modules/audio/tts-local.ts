/* eslint-disable prefer-const */

import type AudioOut from 'pins/audioout'
import ResourceStreamer from 'resourcestreamer'
import { runTTSPlayback } from 'tts-playback-lifecycle'
import { PlaybackProvider } from 'tts-playback-session'
import type { TTSCompletion, TTSDoneListener, TTSPlaybackListener } from 'tts-types'

/* global trace, SharedArrayBuffer */

export type TTSProperty = {
  onPlayed?: TTSPlaybackListener
  onDone?: TTSDoneListener
  sampleRate?: number
  volume?: number
}

export class TTS extends PlaybackProvider {
  audio?: AudioOut
  sampleRate: number
  volume: number
  constructor(props: TTSProperty) {
    super(props)
    this.sampleRate = props.sampleRate ?? 11025
    this.volume = props.volume ?? 0.5
  }
  stream(key: string, volume?: number, callback?: TTSCompletion): void {
    runTTSPlayback(this, callback, (lifecycle) => {
      const audio = lifecycle.openAudio({ streams: 1, sampleRate: this.sampleRate }, volume ?? this.volume)
      lifecycle.attach(
        new ResourceStreamer({
          path: `${key}.maud`,
          audio: {
            out: audio,
            stream: 0,
            sampleRate: this.sampleRate,
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
