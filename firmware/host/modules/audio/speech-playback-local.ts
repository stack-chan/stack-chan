/* eslint-disable prefer-const */

import type AudioOut from 'pins/audioout'
import ResourceStreamer from 'resourcestreamer'
import { runSpeechPlayback } from 'speech-playback-lifecycle'
import type { SpeechCompletion, SpeechDoneListener, SpeechPlaybackListener } from 'speech-playback-types'

/* global trace, SharedArrayBuffer */

export type SpeechPlaybackOptions = {
  onPlayed?: SpeechPlaybackListener
  onDone?: SpeechDoneListener
  sampleRate?: number
  volume?: number
}

export class SpeechPlayback {
  audio?: AudioOut
  onPlayed?: SpeechPlaybackListener
  onDone?: SpeechDoneListener
  streaming: boolean
  sampleRate: number
  volume: number
  constructor(props: SpeechPlaybackOptions) {
    this.onPlayed = props.onPlayed
    this.onDone = props.onDone
    this.streaming = false
    this.sampleRate = props.sampleRate ?? 11025
    this.volume = props.volume ?? 0.5
  }
  stream(key: string, volume?: number, callback?: SpeechCompletion): void {
    runSpeechPlayback(this, callback, (lifecycle) => {
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
