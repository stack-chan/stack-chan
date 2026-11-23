/* global SharedArrayBuffer */

import type { BorrowedAudioBuffer } from 'audio-buffer'
import Modules from 'modules'
import AudioOut from 'pins/audioout'
import type { PcmOutputModule } from '../voice/runtime-types.js'

const WAV_HEADER_SIZE = 44
const STOPWATCH_OUTPUT = 'stackchan/voice/stopwatch-pcm-output'
const STOPWATCH_BLOCK_BYTES = 16384

export type ToneProperty = {
  volume?: number
}

export default class Speaker {
  volume: number

  constructor(props: ToneProperty) {
    this.volume = props.volume ?? 0.5
  }
  async tone(hz: number, duration: number, volume?: number): Promise<void> {
    if (Modules.has(STOPWATCH_OUTPUT)) {
      const sampleRate = 16000
      const samples = new Int16Array(Math.round((sampleRate * duration) / 1000))
      for (let i = 0; i < samples.length; i++) samples[i] = Math.sin((2 * Math.PI * hz * i) / sampleRate) * 32767
      await this.playStopWatchPcm(new Uint8Array(samples.buffer), sampleRate, volume ?? this.volume)
      return
    }
    const audio = new AudioOut({
      streams: 1,
      sampleRate: 24000,
      bitsPerSample: 16,
    })
    return new Promise((resolve) => {
      audio.enqueue(0, AudioOut.Flush)
      audio.enqueue(0, AudioOut.Volume, Math.round((volume ?? this.volume) * 256))
      audio.enqueue(0, AudioOut.Tone, hz, (audio.sampleRate * duration) / 1000)
      audio.enqueue(0, AudioOut.Callback, 1)
      audio.start()

      audio.callback = (_id) => {
        audio.close()
        resolve()
      }
    })
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
      if (Modules.has(STOPWATCH_OUTPUT)) {
        if (numChannels !== 1) return false
        await this.playStopWatchPcm(new Uint8Array(buffer, WAV_HEADER_SIZE), sampleRate, this.volume)
        return true
      }

      // AudioOut.RawSamples requires a non-relocatable buffer; a plain ArrayBuffer is
      // relocatable and rejected, so copy the PCM payload into a SharedArrayBuffer.
      const pcmLength = buffer.byteLength - WAV_HEADER_SIZE
      const shared = new SharedArrayBuffer(pcmLength)
      new Uint8Array(shared).set(new Uint8Array(buffer, WAV_HEADER_SIZE))

      const audio = new AudioOut({ streams: 1, sampleRate, numChannels, bitsPerSample })
      return await new Promise<boolean>((resolve) => {
        audio.enqueue(0, AudioOut.Flush)
        audio.enqueue(0, AudioOut.Volume, Math.round(this.volume * 256))
        // `shared` is retained by this closure until the callback fires, so it is not collected.
        // AudioOut.enqueue is typed for HostBuffer; the native layer also accepts a SharedArrayBuffer.
        audio.enqueue(0, AudioOut.RawSamples, shared as unknown as HostBuffer)
        audio.enqueue(0, AudioOut.Callback, 1)
        audio.start()
        audio.callback = () => {
          audio.close()
          resolve(true)
        }
      })
    } catch (error) {
      trace(`Speaker.play error ${error}\n`)
      return false
    }
  }

  private async playStopWatchPcm(pcm: Uint8Array, sampleRate: number, volume: number): Promise<void> {
    const backend = Modules.importNow(STOPWATCH_OUTPUT, true) as PcmOutputModule
    const output = backend.openOutput(sampleRate, volume, STOPWATCH_BLOCK_BYTES)
    try {
      for (let offset = 0; offset < pcm.length; offset += STOPWATCH_BLOCK_BYTES) {
        await output.write(pcm.subarray(offset, offset + STOPWATCH_BLOCK_BYTES))
      }
      await output.drain()
    } finally {
      output.close()
    }
  }
}
