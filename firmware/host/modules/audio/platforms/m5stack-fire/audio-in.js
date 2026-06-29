// @ts-nocheck

import LegacyAudioIn from 'audioin'
import Timer from 'timer'

const DEFAULT_INTERVAL_MS = 50
const MAX_QUEUE_MS = 500

export default class M5StackFireAudioIn {
  #available = 0
  #bitsPerFrame
  #chunks = []
  #closed = false
  #input
  #intervalMs
  #maxQueueBytes
  #onReadable
  #timer

  constructor(options = {}) {
    this.#input = new LegacyAudioIn()
    this.#intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
    this.#onReadable = options.onReadable
    this.#bitsPerFrame = this.#input.bitsPerSample * this.channels
    this.#maxQueueBytes = Math.ceil((this.sampleRate * (this.#bitsPerFrame >> 3) * MAX_QUEUE_MS) / 1000)
  }

  get audioType() {
    return 'LPCM'
  }

  get bitsPerSample() {
    return this.#input.bitsPerSample
  }

  get channels() {
    return this.#input.numChannels ?? 1
  }

  get format() {
    return 'buffer'
  }

  set format(_value) {}

  get sampleRate() {
    return this.#input.sampleRate
  }

  close() {
    if (this.#closed) {
      return
    }

    this.stop()
    this.#chunks.length = 0
    this.#available = 0
    this.#closed = true
    this.#input.close()
  }

  level(buffer) {
    const samples = new Int16Array(buffer)
    if (!samples.length) {
      return 0
    }

    let total = 0
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i]
      total += sample < 0 ? -sample : sample
    }
    return Math.round(total / samples.length)
  }

  read(targetOrByteLength) {
    if (!this.#available) {
      return undefined
    }

    const target = typeof targetOrByteLength === 'object' ? targetOrByteLength : undefined
    const byteLength = target?.byteLength ?? targetOrByteLength ?? this.#available
    if (byteLength <= 0 || byteLength > this.#available) {
      return undefined
    }

    const output = target ?? new ArrayBuffer(byteLength)
    const outputView = target?.buffer
      ? new Uint8Array(target.buffer, target.byteOffset ?? 0, byteLength)
      : new Uint8Array(output)
    let outputOffset = 0

    while (outputOffset < byteLength) {
      const chunk = this.#chunks[0]
      const take = Math.min(chunk.length, byteLength - outputOffset)
      outputView.set(new Uint8Array(chunk.buffer, chunk.offset, take), outputOffset)
      outputOffset += take
      chunk.offset += take
      chunk.length -= take
      this.#available -= take

      if (!chunk.length) {
        this.#chunks.shift()
      }
    }

    return output
  }

  start() {
    if (this.#timer !== undefined || this.#closed) {
      return
    }

    this.#timer = Timer.repeat(() => this.#poll(), this.#intervalMs)
    this.#poll()
  }

  stop() {
    if (this.#timer === undefined) {
      return
    }

    Timer.clear(this.#timer)
    this.#timer = undefined
  }

  #poll() {
    if (this.#closed) {
      return
    }

    const sampleCount = Math.max(1, Math.floor((this.sampleRate * this.#intervalMs) / 1000))
    const buffer = this.#input.read(sampleCount)
    if (!buffer?.byteLength) {
      return
    }

    this.#chunks.push({ buffer, offset: 0, length: buffer.byteLength })
    this.#available += buffer.byteLength
    this.#trimQueue()

    const onReadable = this.#onReadable ?? this.onReadable
    onReadable?.call(this, this.#available, Math.floor((this.#available * 8) / this.#bitsPerFrame))
  }

  #trimQueue() {
    while (this.#available > this.#maxQueueBytes && this.#chunks.length) {
      const chunk = this.#chunks[0]
      const drop = Math.min(chunk.length, this.#available - this.#maxQueueBytes)
      chunk.offset += drop
      chunk.length -= drop
      this.#available -= drop

      if (!chunk.length) {
        this.#chunks.shift()
      }
    }
  }
}
