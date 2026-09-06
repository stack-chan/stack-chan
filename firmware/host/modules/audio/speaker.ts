/* global SharedArrayBuffer */

import type { BorrowedAudioBuffer } from 'audio-buffer'
import AudioOut from 'pins/audioout'
import { beginTTSPlayback, type TTSPlaybackLifecycle } from 'tts-playback-lifecycle'
import { PlaybackProvider } from 'tts-playback-session'

const WAV_HEADER_SIZE = 44

export type ToneProperty = {
  volume?: number
}

export default class Speaker extends PlaybackProvider {
  volume: number

  constructor(props: ToneProperty = {}) {
    super()
    this.volume = props.volume ?? 0.5
  }
  async tone(hz: number, duration: number, volume?: number): Promise<void> {
    return this.#play<void>((lifecycle) => {
      const audio = lifecycle.openAudio({ streams: 1, sampleRate: 24000, bitsPerSample: 16 }, volume ?? this.volume)
      audio.callback = () => lifecycle.onDone()
      audio.enqueue(0, AudioOut.Flush)
      audio.enqueue(0, AudioOut.Volume, Math.round((volume ?? this.volume) * 256))
      audio.enqueue(0, AudioOut.Tone, hz, (audio.sampleRate * duration) / 1000)
      audio.enqueue(0, AudioOut.Callback, 1)
      audio.start()
    }, undefined)
  }

  async play(buffer: BorrowedAudioBuffer): Promise<boolean> {
    if (buffer.byteLength <= WAV_HEADER_SIZE) return false
    try {
      const view = new DataView(buffer)
      const numChannels = view.getUint16(22, true)
      const sampleRate = view.getUint32(24, true)
      const bitsPerSample = view.getUint16(34, true)
      if (bitsPerSample !== 16 || (numChannels !== 1 && numChannels !== 2)) return false
      if (sampleRate < 8000 || sampleRate > 48000) return false

      // AudioOut.RawSamples requires a non-relocatable buffer; a plain ArrayBuffer is
      // relocatable and rejected, so copy the PCM payload into a SharedArrayBuffer.
      const pcmLength = buffer.byteLength - WAV_HEADER_SIZE
      const shared = new SharedArrayBuffer(pcmLength)
      new Uint8Array(shared).set(new Uint8Array(buffer, WAV_HEADER_SIZE))

      return await this.#play<boolean>((lifecycle) => {
        const audio = lifecycle.openAudio({ streams: 1, sampleRate, numChannels, bitsPerSample }, this.volume)
        audio.callback = () => lifecycle.onDone()
        audio.enqueue(0, AudioOut.Flush)
        audio.enqueue(0, AudioOut.Volume, Math.round(this.volume * 256))
        // `shared` is retained by this closure until the callback fires, so it is not collected.
        // AudioOut.enqueue is typed for HostBuffer; the native layer also accepts a SharedArrayBuffer.
        audio.enqueue(0, AudioOut.RawSamples, shared as unknown as HostBuffer)
        audio.enqueue(0, AudioOut.Callback, 1)
        audio.start()
      }, true)
    } catch (error) {
      trace(`Speaker.play error ${error}\n`)
      return false
    }
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
