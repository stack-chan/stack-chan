/* eslint-disable prefer-const */

import Resource from 'Resource'
import type AudioOut from 'pins/audioout'
import ResourceStreamer from 'resourcestreamer'
import { StackchanError } from 'stackchan/errors'
import { runTTSPlayback } from 'tts-playback-lifecycle'
import { PlaybackProvider } from 'tts-playback-session'
import type { TTSCompletion, TTSDoneListener, TTSPlaybackListener } from 'tts-types'

/* global trace, SharedArrayBuffer */

export type TTSProperty = {
  onPlayed?: TTSPlaybackListener
  onDone?: TTSDoneListener
  volume?: number
}

export class TTS extends PlaybackProvider {
  audio?: AudioOut
  volume: number
  constructor(props: TTSProperty) {
    super(props)
    this.volume = props.volume ?? 0.5
  }
  stream(key: string, volume?: number, callback?: TTSCompletion): void {
    runTTSPlayback(this, callback, (lifecycle) => {
      const path = `${key}.maud`
      const resource = new Resource(path)
      if (resource.byteLength < 12) throw new StackchanError('IO', 'Truncated audio resource')
      const header = new DataView(resource)
      const sampleRate = header.getUint16(4, true)
      if (
        header.getUint16(0, false) !== 0x6d61 ||
        header.getUint8(2) !== 1 ||
        header.getUint8(3) !== 16 ||
        header.getUint8(6) !== 1 ||
        header.getUint8(7) !== 0 ||
        sampleRate < 8000 ||
        sampleRate > 48000 ||
        !header.getUint32(8, true) ||
        resource.byteLength !== 12 + header.getUint32(8, true) * 2
      )
        throw new StackchanError('UNSUPPORTED', 'Audio resources must be mono PCM16 MAUD at 8–48 kHz')
      const audio = lifecycle.openAudio({ streams: 1, sampleRate }, volume ?? this.volume)
      lifecycle.attach(
        new ResourceStreamer({
          path,
          audio: {
            out: audio,
            stream: 0,
            // ResourceStreamer uses this rate only for queue sizing. Align its
            // one-eighth-second blocks to PCM16 while keeping the real output rate.
            sampleRate: Math.ceil(sampleRate / 8) * 8,
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
