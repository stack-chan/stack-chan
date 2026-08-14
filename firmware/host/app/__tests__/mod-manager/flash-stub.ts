let writes = 0

export function writeCount(): number {
  return writes
}

export default class FlashStub {
  readonly byteLength = 64
  readonly blockSize = 16
  readonly storage = new Uint8Array(this.byteLength)

  constructor(_partition: string) {
    writes = 0
  }

  erase(sector: number): void {
    const offset = sector * this.blockSize
    this.storage.fill(0xff, offset, offset + this.blockSize)
  }

  write(offset: number, byteLength: number, buffer: Uint8Array): void {
    this.storage.set(buffer.subarray(0, byteLength), offset)
    writes += 1
  }

  read(offset: number, byteLength: number): ArrayBuffer {
    return this.storage.slice(offset, offset + byteLength).buffer
  }
}
