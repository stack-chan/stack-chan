export type SpeakerDrainResult = {
  consumedBytes: number
  power: number
}

type SpeakerQueueEntry = { kind: 'pcm'; payload: Uint8Array } | { kind: 'caption'; text: string }

/**
 * PCM and caption queue shared by the USB receiver and AudioOut callback.
 *
 * AudioOut may report writable space before USB has delivered the next PCM
 * frame. Keep that space until enqueuePcm() pumps the queue again; otherwise
 * the output waits for another hardware callback and produces an avoidable
 * gap.
 */
export class SpeakerPlaybackBuffer {
  #entries: SpeakerQueueEntry[] = []
  #entryOffset = 0
  #pcmBytes = 0
  #captionCount = 0
  #writableBytes = 0

  get pcmBytes(): number {
    return this.#pcmBytes
  }

  get captionCount(): number {
    return this.#captionCount
  }

  get writableBytes(): number {
    return this.#writableBytes
  }

  enqueuePcm(payload: Uint8Array): void {
    if (payload.byteLength === 0 || payload.byteLength % 2 !== 0) {
      throw new RangeError('speaker PCM must contain complete 16-bit samples')
    }
    this.#entries.push({ kind: 'pcm', payload })
    this.#pcmBytes += payload.byteLength
  }

  enqueueCaption(text: string): void {
    this.#entries.push({ kind: 'caption', text })
    this.#captionCount += 1
  }

  setWritableBytes(byteLength: number): void {
    this.#writableBytes = Math.max(0, byteLength - (byteLength % 2))
  }

  drain(write: (payload: Uint8Array) => void, showCaption: (text: string) => void): SpeakerDrainResult {
    let consumedBytes = 0
    let sampleCount = 0
    let sumSquares = 0

    while (this.#writableBytes >= 2 && this.#entries.length > 0) {
      const entry = this.#entries[0]
      if (entry.kind === 'caption') {
        if (!this.#hasFollowingPcm()) break
        this.#entries.shift()
        this.#captionCount -= 1
        showCaption(entry.text)
        continue
      }

      const available = entry.payload.byteLength - this.#entryOffset
      const count = Math.min(this.#writableBytes, available) & ~1
      if (count === 0) break
      const chunk = entry.payload.subarray(this.#entryOffset, this.#entryOffset + count)
      for (let offset = 0; offset < chunk.byteLength; offset += 2) {
        let sample = chunk[offset] | (chunk[offset + 1] << 8)
        if (sample & 0x8000) sample -= 0x10000
        sumSquares += sample * sample
        sampleCount += 1
      }
      write(chunk)
      this.#entryOffset += count
      this.#pcmBytes -= count
      this.#writableBytes -= count
      consumedBytes += count
      if (this.#entryOffset === entry.payload.byteLength) {
        this.#entries.shift()
        this.#entryOffset = 0
      }
    }

    return {
      consumedBytes,
      power: sampleCount > 0 ? Math.sqrt(sumSquares / sampleCount) : 0,
    }
  }

  clear(): void {
    this.#entries = []
    this.#entryOffset = 0
    this.#pcmBytes = 0
    this.#captionCount = 0
    this.#writableBytes = 0
  }

  #hasFollowingPcm(): boolean {
    for (let index = 1; index < this.#entries.length; index += 1) {
      if (this.#entries[index].kind === 'pcm') return true
    }
    return false
  }
}
