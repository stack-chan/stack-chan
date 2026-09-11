import { type USBSerialIO, type USBSerialOptions, USBSerialOutputFullError } from 'stackchan-usb-serial-types'

export default class FakeUSBSerial implements USBSerialIO {
  static get current(): FakeUSBSerial {
    return (globalThis as typeof globalThis & { usbTestSerial: FakeUSBSerial }).usbTestSerial
  }
  connected = true
  format: 'buffer' = 'buffer'
  readonly writes: Uint8Array[] = []
  writeAttempts = 0
  outputFull = false
  closed = false
  #options: USBSerialOptions
  #incoming = new Uint8Array(0)

  constructor(options: USBSerialOptions) {
    this.#options = options
    ;(globalThis as typeof globalThis & { usbTestSerial?: FakeUSBSerial }).usbTestSerial = this
  }

  enqueue(bytes: Uint8Array): void {
    const combined = new Uint8Array(this.#incoming.byteLength + bytes.byteLength)
    combined.set(this.#incoming)
    combined.set(bytes, this.#incoming.byteLength)
    this.#incoming = combined
  }

  notifyReadable(): void {
    this.#options.onReadable?.call(this, this.#incoming.byteLength)
  }

  notifyWritable(): void {
    this.#options.onWritable?.call(this)
  }

  notifyError(): void {
    this.#options.onError?.call(this)
  }

  read(): ArrayBuffer | undefined
  read(maximumBytes: number): ArrayBuffer | undefined
  read(target: Uint8Array): number | undefined
  read(target?: number | Uint8Array): ArrayBuffer | number | undefined {
    if (this.closed) throw new Error('closed')
    if (this.#incoming.byteLength === 0) return
    const maximum =
      target instanceof Uint8Array ? target.byteLength : typeof target === 'number' ? target : this.#incoming.byteLength
    const count = Math.min(maximum, this.#incoming.byteLength)
    const bytes = this.#incoming.slice(0, count)
    this.#incoming = this.#incoming.slice(count)
    if (target instanceof Uint8Array) {
      target.set(bytes)
      return count
    }
    return bytes.buffer
  }

  write(source: Uint8Array): void {
    if (this.closed) throw new Error('closed')
    this.writeAttempts += 1
    if (this.outputFull) throw new USBSerialOutputFullError()
    this.writes.push(source.slice())
  }

  close(): void {
    this.closed = true
  }
}
