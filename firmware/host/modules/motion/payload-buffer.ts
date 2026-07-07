export class PayloadBuffer {
  #buffer: Uint8Array

  constructor(initialSize = 0) {
    this.#buffer = new Uint8Array(initialSize)
  }

  ensureCapacity(size: number): void {
    if (this.#buffer.length < size) {
      this.#buffer = new Uint8Array(size)
    }
  }

  copyFrom(source: Uint8Array, length: number, offset = 0): Uint8Array {
    this.ensureCapacity(length)
    for (let i = 0; i < length; i++) {
      this.#buffer[i] = source[offset + i]
    }
    return this.#buffer.subarray(0, length)
  }
}
