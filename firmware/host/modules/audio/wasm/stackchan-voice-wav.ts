export const STACKCHAN_VOICE_OUTPUT_SAMPLE_RATE = 24000

const BYTES_PER_SAMPLE = 2
const DEFAULT_CHUNK_SAMPLES = 2048
const INITIAL_PCM_CAPACITY = 8192
const WAV_HEADER_BYTES = 44

export type StackchanVoiceRenderer = {
  say(text: string, speed?: number): void
  read24(buffer: ArrayBuffer): number
}

export type StackchanVoiceRenderOptions = {
  chunkSamples?: number
  speed?: number
  volume?: number
}

export type RenderedStackchanVoice = {
  buffer: ArrayBuffer
  power: number
  samples: number
}

function writeAscii(target: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    target[offset + index] = value.charCodeAt(index)
  }
}

function writeUint16LE(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff
  target[offset + 1] = (value >>> 8) & 0xff
}

function writeUint32LE(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff
  target[offset + 1] = (value >>> 8) & 0xff
  target[offset + 2] = (value >>> 16) & 0xff
  target[offset + 3] = (value >>> 24) & 0xff
}

class PCMCollector {
  #bytes = new Uint8Array(INITIAL_PCM_CAPACITY)
  #length = 0
  #sampleCount = 0
  #sumSquares = 0

  append(buffer: ArrayBuffer, samples: number, volume: number): void {
    const source = new Int16Array(buffer)
    if (!Number.isInteger(samples) || samples < 0 || samples > source.length) {
      throw new RangeError(`invalid stackchan-voice sample count: ${samples}`)
    }

    this.#ensureCapacity(this.#length + samples * BYTES_PER_SAMPLE)
    for (let index = 0; index < samples; index += 1) {
      const scaled = Math.max(-32768, Math.min(32767, Math.round(source[index] * volume)))
      this.#bytes[this.#length] = scaled & 0xff
      this.#bytes[this.#length + 1] = (scaled >> 8) & 0xff
      this.#length += BYTES_PER_SAMPLE
      this.#sumSquares += scaled * scaled
    }
    this.#sampleCount += samples
  }

  finish(): RenderedStackchanVoice {
    const wav = new Uint8Array(WAV_HEADER_BYTES + this.#length)
    const byteRate = STACKCHAN_VOICE_OUTPUT_SAMPLE_RATE * BYTES_PER_SAMPLE

    writeAscii(wav, 0, 'RIFF')
    writeUint32LE(wav, 4, wav.byteLength - 8)
    writeAscii(wav, 8, 'WAVE')
    writeAscii(wav, 12, 'fmt ')
    writeUint32LE(wav, 16, 16)
    writeUint16LE(wav, 20, 1)
    writeUint16LE(wav, 22, 1)
    writeUint32LE(wav, 24, STACKCHAN_VOICE_OUTPUT_SAMPLE_RATE)
    writeUint32LE(wav, 28, byteRate)
    writeUint16LE(wav, 32, BYTES_PER_SAMPLE)
    writeUint16LE(wav, 34, 16)
    writeAscii(wav, 36, 'data')
    writeUint32LE(wav, 40, this.#length)
    wav.set(this.#bytes.subarray(0, this.#length), WAV_HEADER_BYTES)

    return {
      buffer: wav.buffer,
      power: this.#sampleCount === 0 ? 0 : Math.sqrt(this.#sumSquares / this.#sampleCount),
      samples: this.#sampleCount,
    }
  }

  #ensureCapacity(required: number): void {
    if (required <= this.#bytes.byteLength) return
    let capacity = this.#bytes.byteLength
    while (capacity < required) capacity *= 2
    const next = new Uint8Array(capacity)
    next.set(this.#bytes.subarray(0, this.#length))
    this.#bytes = next
  }
}

export function renderStackchanVoiceWav(
  voice: StackchanVoiceRenderer,
  text: string,
  options: StackchanVoiceRenderOptions = {},
): RenderedStackchanVoice {
  const chunkSamples = Math.max(1, Math.floor(options.chunkSamples ?? DEFAULT_CHUNK_SAMPLES))
  const speed = options.speed ?? 100
  const volume = Math.max(0, Math.min(1, options.volume ?? 1))
  const chunk = new ArrayBuffer(chunkSamples * BYTES_PER_SAMPLE)
  const collector = new PCMCollector()

  voice.say(text, speed)
  while (true) {
    const samples = voice.read24(chunk)
    if (samples === 0) return collector.finish()
    collector.append(chunk, samples, volume)
  }
}
