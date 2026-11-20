export class Digest {
  constructor(_algorithm: string) {}

  write(_value: ArrayBuffer): void {}

  close(): ArrayBuffer {
    return new ArrayBuffer(32)
  }
}
