import { STACKCHAN_CRC_BYTES, STACKCHAN_HEADER_BYTES, type StackChanFrame } from 'stackchan-usb-protocol'

export const STACKCHAN_FRAME_OVERHEAD_BYTES = STACKCHAN_HEADER_BYTES + STACKCHAN_CRC_BYTES

export class BoundedEventFrameQueue {
  readonly #maximumFrames: number
  readonly #maximumBytes: number
  #frames: StackChanFrame[] = []
  #remainingBytes = 0

  constructor(maximumFrames: number, maximumBytes: number) {
    if (!Number.isInteger(maximumFrames) || maximumFrames <= 0) {
      throw new RangeError('maximum event frames must be positive')
    }
    if (!Number.isInteger(maximumBytes) || maximumBytes <= 0) {
      throw new RangeError('maximum event bytes must be positive')
    }
    this.#maximumFrames = maximumFrames
    this.#maximumBytes = maximumBytes
  }

  get length(): number {
    return this.#frames.length
  }

  get remainingBytes(): number {
    return this.#remainingBytes
  }

  tryEnqueue(frames: ReadonlyArray<StackChanFrame>): boolean {
    let bytes = 0
    for (const frame of frames) bytes += frameWireBytes(frame)
    if (
      this.#frames.length + frames.length > this.#maximumFrames ||
      this.#remainingBytes + bytes > this.#maximumBytes
    ) {
      return false
    }
    this.#frames.push(...frames)
    this.#remainingBytes += bytes
    return true
  }

  current(): StackChanFrame | undefined {
    return this.#frames[0]
  }

  advance(): void {
    const frame = this.#frames.shift()
    if (!frame) throw new RangeError('event frame queue is empty')
    this.#remainingBytes -= frameWireBytes(frame)
  }

  clear(): void {
    this.#frames = []
    this.#remainingBytes = 0
  }
}

function frameWireBytes(frame: StackChanFrame): number {
  return STACKCHAN_FRAME_OVERHEAD_BYTES + (frame.payload?.byteLength ?? 0)
}
