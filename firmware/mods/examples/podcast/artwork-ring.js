export const ART_SIZE = 64
export const RING_BYTES = 16 * 1024
export const MAX_ART_BYTES = 2 * 1024 * 1024

/** Single producer; the native JPEG Worker is the sole consumer. Publish only after copying. */
export class ArtworkRing {
  constructor(data, state) {
    this.bytes = new Uint8Array(data)
    this.state = new Int32Array(state)
  }
  get cancelled() {
    return Atomics.load(this.state, 3) !== 0
  }
  get writable() {
    return this.bytes.length - ((Atomics.load(this.state, 0) - Atomics.load(this.state, 1)) >>> 0)
  }
  target(count) {
    const offset = (Atomics.load(this.state, 0) >>> 0) % this.bytes.length
    return this.bytes.subarray(offset, offset + Math.min(count, this.writable, this.bytes.length - offset))
  }
  commit(count) {
    if (count < 0 || count > this.writable) throw new Error('Artwork ring overflow')
    Atomics.add(this.state, 0, count)
  }
  end() {
    Atomics.store(this.state, 2, 1)
  }
  cancel() {
    Atomics.store(this.state, 3, 1)
  }
}
