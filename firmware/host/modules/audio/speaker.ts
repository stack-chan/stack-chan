import type { BorrowedAudioBuffer } from 'audio-buffer'
import AudioOut from 'modern-audio-out'

const WAV_HEADER_SIZE = 44
const TONE_SAMPLE_RATE = 24_000
const BITS_PER_SAMPLE = 16
const BYTES_PER_SAMPLE = BITS_PER_SAMPLE / 8

type ModernAudioOut = {
  volume: number
  write(samples: ArrayBuffer | ArrayBufferView): void
  start(): void
  stop(): void
  close(): void
}

type ModernAudioOutConstructor = new (options: {
  sampleRate: number
  bitsPerSample: number
  channels: number
  onWritable: (size: number) => void
}) => ModernAudioOut

export type ToneProperty = {
  volume?: number
}

type PCMSource = {
  readonly byteLength: number
  fill(target: Uint8Array, sourceOffset: number, byteLength: number): void
}

function checkedVolume(volume: number): number {
  if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
    throw new RangeError('volume must be between 0 and 1')
  }
  return volume
}

function bufferSource(buffer: BorrowedAudioBuffer, byteOffset: number): PCMSource {
  const source = new Uint8Array(buffer, byteOffset)
  return {
    byteLength: source.byteLength,
    fill(target, sourceOffset, byteLength) {
      target.set(source.subarray(sourceOffset, sourceOffset + byteLength))
    },
  }
}

function toneSource(hz: number, duration: number): PCMSource {
  if (!Number.isFinite(hz) || hz <= 0) throw new RangeError('tone frequency must be positive')
  if (!Number.isFinite(duration) || duration <= 0) throw new RangeError('tone duration must be positive')
  const sampleCount = Math.max(1, Math.round((TONE_SAMPLE_RATE * duration) / 1000))
  return {
    byteLength: sampleCount * BYTES_PER_SAMPLE,
    fill(target, sourceOffset, byteLength) {
      const view = new DataView(target.buffer, target.byteOffset, byteLength)
      const firstSample = sourceOffset / BYTES_PER_SAMPLE
      const samples = byteLength / BYTES_PER_SAMPLE
      for (let index = 0; index < samples; index += 1) {
        const phase = (2 * Math.PI * hz * (firstSample + index)) / TONE_SAMPLE_RATE
        view.setInt16(index * BYTES_PER_SAMPLE, Math.round(Math.sin(phase) * 0x7fff), true)
      }
    },
  }
}

export default class Speaker {
  volume: number

  constructor(props: ToneProperty = {}) {
    this.volume = checkedVolume(props.volume ?? 0.5)
  }

  async tone(hz: number, duration: number, volume?: number): Promise<void> {
    await this.playPCM(toneSource(hz, duration), TONE_SAMPLE_RATE, 1, checkedVolume(volume ?? this.volume))
  }

  async play(buffer: BorrowedAudioBuffer): Promise<boolean> {
    if (buffer.byteLength <= WAV_HEADER_SIZE) return false
    try {
      const view = new DataView(buffer)
      const numChannels = view.getUint16(22, true)
      const sampleRate = view.getUint32(24, true)
      const bitsPerSample = view.getUint16(34, true)
      if (bitsPerSample !== BITS_PER_SAMPLE || (numChannels !== 1 && numChannels !== 2)) return false
      if (sampleRate < 8000 || sampleRate > 48_000) return false
      const pcmLength = buffer.byteLength - WAV_HEADER_SIZE
      if (pcmLength % BYTES_PER_SAMPLE !== 0) return false
      await this.playPCM(bufferSource(buffer, WAV_HEADER_SIZE), sampleRate, numChannels, this.volume)
      return true
    } catch (error) {
      trace(`Speaker.play error ${String(error)}\n`)
      return false
    }
  }

  private playPCM(source: PCMSource, sampleRate: number, channels: number, volume: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let output: ModernAudioOut | undefined
      let sourceOffset = 0
      let freeBytes = 0
      let pendingBytes = 0
      let draining = false
      let settled = false
      let scratch = new Uint8Array(0)

      const close = () => {
        const current = output
        output = undefined
        if (!current) return
        try {
          current.stop()
        } finally {
          current.close()
        }
      }

      const finish = (error?: unknown) => {
        if (settled) return
        settled = true
        try {
          close()
        } catch (closeError) {
          if (error === undefined) error = closeError
        }
        if (error === undefined) resolve()
        else reject(error)
      }

      const onWritable = (rawSize: number) => {
        if (!output || settled) return
        try {
          const writable = rawSize - (rawSize % BYTES_PER_SAMPLE)
          const consumed = Math.max(0, writable - freeBytes)
          pendingBytes = Math.max(0, pendingBytes - consumed)
          freeBytes = writable
          if (draining) {
            if (pendingBytes === 0) finish()
            return
          }
          if (writable === 0) return

          if (scratch.byteLength < writable) scratch = new Uint8Array(writable)
          const chunk = scratch.subarray(0, writable)
          chunk.fill(0)
          const remaining = source.byteLength - sourceOffset
          const use = Math.min(writable, remaining)
          source.fill(chunk, sourceOffset, use)
          sourceOffset += use
          output.write(chunk)
          freeBytes -= writable
          pendingBytes += writable
          if (sourceOffset >= source.byteLength) draining = true
        } catch (error) {
          finish(error)
        }
      }

      try {
        const Output = AudioOut as unknown as ModernAudioOutConstructor
        output = new Output({
          sampleRate,
          bitsPerSample: BITS_PER_SAMPLE,
          channels,
          onWritable,
        })
        output.volume = checkedVolume(volume)
        output.start()
      } catch (error) {
        finish(error)
      }
    })
  }
}
