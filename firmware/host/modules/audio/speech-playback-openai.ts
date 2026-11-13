/* eslint-disable prefer-const */

import OpenAIStreamer from 'openaistreamer'
import type AudioOut from 'pins/audioout'
import { runSpeechPlayback } from 'speech-playback-lifecycle'
import type { SpeechCompletion, SpeechDoneListener, SpeechPlaybackListener } from 'speech-playback-types'

/* global trace, SharedArrayBuffer */

export type SpeechPlaybackOptions = {
  onPlayed?: SpeechPlaybackListener
  onDone?: SpeechDoneListener
  token: string
  model?: string
  voice?: string
  speed?: number
  instructions?: string
  volume?: number
}

export class SpeechPlayback {
  audio?: AudioOut
  onPlayed?: SpeechPlaybackListener
  onDone?: SpeechDoneListener
  token: string
  model: string
  voice: string
  speed: number
  instructions: string
  volume: number
  streaming: boolean
  constructor(props: SpeechPlaybackOptions) {
    this.onPlayed = props.onPlayed
    this.onDone = props.onDone
    this.streaming = false
    this.token = props.token
    this.model = props.model ?? 'tts-1'
    this.voice = props.voice ?? 'alloy'
    this.speed = props.speed ?? 1
    this.instructions = props.instructions ?? ''
    this.volume = props.volume ?? 0.5
  }
  stream(text: string, volume?: number, callback?: SpeechCompletion): void {
    runSpeechPlayback(this, callback, (lifecycle) => {
      const audio = lifecycle.openAudio({ streams: 1, bitsPerSample: 16, sampleRate: 24000 }, volume ?? this.volume)
      lifecycle.attach(
        new OpenAIStreamer({
          input: text,
          key: this.token,
          model: this.model,
          voice: this.voice,
          speed: this.speed,
          instructions: this.instructions,
          response_format: 'wav',
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
