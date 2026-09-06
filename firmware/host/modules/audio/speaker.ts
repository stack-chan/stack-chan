/* global SharedArrayBuffer */

import type { BorrowedAudioBuffer } from 'audio-buffer'
import type { AudioOutputPort } from 'audio-ports'
import { parsePcmWave } from 'pcm-wave'
import AudioOut from 'pins/audioout'
import { finiteNumber } from 'stackchan/errors'
import {
  DEFAULT_PLAYBACK_VOLUME,
  MAX_TONE_DURATION_MS,
  MAX_TONE_HZ,
  MIN_TONE_HZ,
  TONE_SAMPLE_RATE,
} from 'stackchan-contracts/audio-playback'
import { beginTTSPlayback, type TTSPlaybackLifecycle } from 'tts-playback-lifecycle'
import { PlaybackProvider } from 'tts-playback-session'

const retainedPcm = Symbol('stackchan-speaker-pcm')
type BufferedOutput = AudioOut & { [retainedPcm]?: SharedArrayBuffer }

export type ToneProperty = {
  volume?: number
}

export default class Speaker extends PlaybackProvider implements AudioOutputPort {
  readonly volume: number

  constructor(props: ToneProperty = {}) {
    super()
    this.volume = props.volume ?? DEFAULT_PLAYBACK_VOLUME
    finiteNumber(this.volume, 'volume', 0, 1)
  }
  async tone(hz: number, duration: number, volume = this.volume): Promise<void> {
    return this.#play<void>((lifecycle) => {
      finiteNumber(hz, 'hz', MIN_TONE_HZ, MAX_TONE_HZ)
      finiteNumber(duration, 'durationMs', 0, MAX_TONE_DURATION_MS)
      finiteNumber(volume, 'volume', 0, 1)
      const audio = lifecycle.openAudio({ streams: 1, sampleRate: TONE_SAMPLE_RATE, bitsPerSample: 16 }, volume)
      audio.callback = () => lifecycle.onDone()
      audio.enqueue(0, AudioOut.Tone, hz, Math.ceil((audio.sampleRate * duration) / 1000))
      audio.enqueue(0, AudioOut.Callback, 1)
      audio.start()
    }, undefined)
  }

  async play(buffer: BorrowedAudioBuffer, volume = this.volume): Promise<boolean> {
    return this.#play<boolean>((lifecycle) => {
      finiteNumber(volume, 'volume', 0, 1)
      const { sampleRate, numChannels, bitsPerSample, dataOffset, dataBytes } = parsePcmWave(buffer)
      // RawSamples retains only a C pointer. AudioOut's remembered JS object
      // must keep the PCM alive until close confirms it no longer uses that pointer.
      const pcm = new SharedArrayBuffer(dataBytes)
      new Uint8Array(pcm).set(new Uint8Array(buffer, dataOffset, dataBytes))
      const audio = lifecycle.openAudio({ streams: 1, sampleRate, numChannels, bitsPerSample }, volume)
      const buffered = audio as BufferedOutput
      buffered[retainedPcm] = pcm
      void lifecycle.released.then(
        () => {
          delete buffered[retainedPcm]
        },
        () => {
          // Unconfirmed close may still be reading. Keep its buffer pinned to
          // the native object's remembered JS wrapper; the provider is faulted.
        },
      )
      audio.callback = () => lifecycle.onDone()
      audio.enqueue(0, AudioOut.RawSamples, pcm as unknown as HostBuffer)
      audio.enqueue(0, AudioOut.Callback, 1)
      audio.start()
    }, true)
  }

  #play<T>(start: (lifecycle: TTSPlaybackLifecycle) => void, value: T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const lifecycle = beginTTSPlayback(this, (error) => {
        if (error !== undefined) reject(error)
        else resolve(value)
      })
      if (!lifecycle) return
      try {
        start(lifecycle)
      } catch (error) {
        lifecycle.fail(error)
      }
    })
  }
}
