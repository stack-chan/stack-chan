type QueuedFrame = {
  bytes: Uint8Array
  type: number
  control: number
  streamId: number
}

export class StreamTxQueue {
  readonly #maximumBytes: number
  #items: QueuedFrame[] = []
  #offset = 0
  #remainingBytes = 0

  constructor(maximumBytes: number) {
    if (!Number.isInteger(maximumBytes) || maximumBytes <= 0) throw new RangeError('maximum bytes must be positive')
    this.#maximumBytes = maximumBytes
  }

  get remainingBytes(): number {
    return this.#remainingBytes
  }

  enqueue(bytes: Uint8Array, type: number, control: number, streamId: number): boolean {
    if (this.#remainingBytes + bytes.byteLength > this.#maximumBytes) return false
    this.#items.push({ bytes, type, control, streamId })
    this.#remainingBytes += bytes.byteLength
    return true
  }

  current(): Uint8Array | undefined {
    const current = this.#items[0]
    return current?.bytes.subarray(this.#offset)
  }

  advance(writtenBytes: number): void {
    const current = this.#items[0]
    if (!current || writtenBytes <= 0 || writtenBytes > current.bytes.byteLength - this.#offset) {
      throw new RangeError('invalid transmitted byte count')
    }
    this.#offset += writtenBytes
    this.#remainingBytes -= writtenBytes
    if (this.#offset === current.bytes.byteLength) {
      this.#items.shift()
      this.#offset = 0
    }
  }

  dropSpeakerFlowFrames(streamId: number): void {
    const firstIsPartial = this.#offset > 0
    this.#items = this.#items.filter((item, index) => {
      if (firstIsPartial && index === 0) return true
      const drop =
        item.streamId === streamId &&
        (item.type === DIAGNOSTICS_FRAME_TYPE ||
          (item.type === CONTROL_FRAME_TYPE && item.control === SPEAKER_CREDIT_CONTROL))
      if (drop) this.#remainingBytes -= item.bytes.byteLength
      return !drop
    })
  }

  clear(): void {
    this.#items = []
    this.#offset = 0
    this.#remainingBytes = 0
  }
}

const CONTROL_FRAME_TYPE = 0
const DIAGNOSTICS_FRAME_TYPE = 5
const SPEAKER_CREDIT_CONTROL = 33
