/* eslint-disable prefer-const */

import calculatePower from 'calculate-power'
import AudioOut from 'pins/audioout'
import ResourceStreamer from 'resourcestreamer'
import type { TTSCompletion, TTSDoneListener, TTSPlaybackListener } from 'tts-types'

/* global trace, SharedArrayBuffer */

export type TTSProperty = {
  onPlayed?: TTSPlaybackListener
  onDone?: TTSDoneListener
  sampleRate?: number
  volume?: number
}

export class TTS {
  audio?: AudioOut
  onPlayed?: TTSPlaybackListener
  onDone?: TTSDoneListener
  streaming: boolean
  sampleRate: number
  volume: number
  constructor(props: TTSProperty) {
    this.onPlayed = props.onPlayed
    this.onDone = props.onDone
    this.streaming = false
    this.sampleRate = props.sampleRate ?? 11025
    this.volume = props.volume ?? 0.5
  }
  stream(key: string, volume?: number, callback?: TTSCompletion): void {
    if (this.streaming) {
      callback?.(new Error('already playing'))
      return
    }
    this.streaming = true
    const { onPlayed, onDone } = this
    this.audio = new AudioOut({ streams: 1, sampleRate: this.sampleRate })
    this.audio.enqueue(0, AudioOut.Volume, Math.round((volume ?? this.volume) * 256))
    const audio = this.audio
    const streamer = new ResourceStreamer({
      path: `${key}.maud`,
      audio: {
        out: audio,
        stream: 0,
        sampleRate: this.sampleRate,
      },
      onPlayed: (buffer) => {
        const power = calculatePower(buffer)
        onPlayed?.(power)
      },
      onReady(this: ResourceStreamer, state) {
        trace(`Ready: ${state}\n`)
        if (state) {
          audio.start()
        } else {
          audio.stop()
        }
      },
      onError: (e) => {
        trace('ERROR: ', e, '\n')
        this.streaming = false
        streamer?.close()
        this.audio?.close()
        this.audio = undefined
        callback?.(e)
      },
      onDone: () => {
        trace('DONE\n')
        this.streaming = false
        streamer?.close()
        this.audio?.close()
        this.audio = undefined
        onDone?.()
        callback?.()
      },
    })
  }
}
