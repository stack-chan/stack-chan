import { finiteNumber, StackchanError } from 'stackchan/errors'

/** Frame before decoding UTF-8: TCP chunks need not end at a character or message boundary. */
export class DelimitedTextStream {
  readonly #buffer: ArrayBuffer
  readonly #bytes: Uint8Array
  readonly #delimiter: number
  readonly #decode: (buffer: ArrayBuffer) => string
  readonly #receive: (message: string) => void
  #length = 0
  constructor(
    delimiter: string,
    maximumBytes: number,
    decode: (buffer: ArrayBuffer) => string,
    receive: (message: string) => void,
  ) {
    finiteNumber(maximumBytes, 'maximum message bytes', 1, 65_536)
    if (!Number.isInteger(maximumBytes) || delimiter.length !== 1 || delimiter.charCodeAt(0) > 127)
      throw new StackchanError('INVALID_ARGUMENT', 'A one-byte ASCII delimiter and integer message limit are required')
    this.#buffer = new ArrayBuffer(maximumBytes)
    this.#bytes = new Uint8Array(this.#buffer)
    this.#delimiter = delimiter.charCodeAt(0)
    this.#decode = decode
    this.#receive = receive
  }
  push(chunk: ArrayBuffer): void {
    for (const byte of new Uint8Array(chunk)) {
      if (byte === this.#delimiter) {
        const length = this.#length
        this.#length = 0
        if (length) this.#receive(this.#decode(this.#buffer.slice(0, length)))
      } else {
        if (this.#length === this.#bytes.length) throw new StackchanError('IO', 'Stream message exceeds its byte limit')
        this.#bytes[this.#length++] = byte
      }
    }
  }
}
