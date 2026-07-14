const READ_INDEX = 0
const WRITE_INDEX = 1
const STATE_WORDS = 2

export type SharedByteRingBuffers = {
  data: SharedArrayBuffer
  state: SharedArrayBuffer
}

/** Single-producer/single-consumer byte ring backed by shared memory. */
export class SharedByteRing {
  readonly bytes: Uint8Array
  readonly state: Int32Array

  constructor(data: SharedArrayBuffer, state: SharedArrayBuffer) {
    if (data.byteLength < 2) throw new RangeError('Shared byte ring must hold at least two bytes')
    if (state.byteLength < STATE_WORDS * Int32Array.BYTES_PER_ELEMENT) {
      throw new RangeError('Shared byte ring state is too small')
    }
    this.bytes = new Uint8Array(data)
    this.state = new Int32Array(state, 0, STATE_WORDS)
  }

  static allocate(byteLength: number): SharedByteRing {
    return new SharedByteRing(
      new SharedArrayBuffer(byteLength),
      new SharedArrayBuffer(STATE_WORDS * Int32Array.BYTES_PER_ELEMENT),
    )
  }

  get buffers(): SharedByteRingBuffers {
    return {
      data: this.bytes.buffer as SharedArrayBuffer,
      state: this.state.buffer as SharedArrayBuffer,
    }
  }

  get readableBytes(): number {
    const read = Atomics.load(this.state, READ_INDEX)
    const write = Atomics.load(this.state, WRITE_INDEX)
    return write >= read ? write - read : this.bytes.byteLength - read + write
  }

  get writableBytes(): number {
    return this.bytes.byteLength - this.readableBytes - 1
  }

  readableView(maximum = this.bytes.byteLength): Uint8Array {
    const read = Atomics.load(this.state, READ_INDEX)
    const write = Atomics.load(this.state, WRITE_INDEX)
    if (read === write) return new Uint8Array(this.bytes.buffer, 0, 0)
    const contiguous = read < write ? write - read : this.bytes.byteLength - read
    return new Uint8Array(this.bytes.buffer, read, Math.min(contiguous, maximum))
  }

  writableView(maximum = this.bytes.byteLength): Uint8Array {
    const read = Atomics.load(this.state, READ_INDEX)
    const write = Atomics.load(this.state, WRITE_INDEX)
    let contiguous: number
    if (write < read) contiguous = read - write - 1
    else if (read === 0) contiguous = this.bytes.byteLength - write - 1
    else contiguous = this.bytes.byteLength - write
    return new Uint8Array(this.bytes.buffer, write, Math.min(contiguous, maximum))
  }

  advanceRead(count: number): void {
    if (!Number.isInteger(count) || count < 0 || count > this.readableBytes) {
      throw new RangeError('Cannot consume beyond shared byte ring contents')
    }
    const read = Atomics.load(this.state, READ_INDEX)
    Atomics.store(this.state, READ_INDEX, (read + count) % this.bytes.byteLength)
  }

  advanceWrite(count: number): void {
    if (!Number.isInteger(count) || count < 0 || count > this.writableBytes) {
      throw new RangeError('Cannot produce beyond shared byte ring capacity')
    }
    const write = Atomics.load(this.state, WRITE_INDEX)
    Atomics.store(this.state, WRITE_INDEX, (write + count) % this.bytes.byteLength)
  }
}
