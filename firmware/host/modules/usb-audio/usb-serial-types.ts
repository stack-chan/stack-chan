export const USB_SERIAL_MAX_WRITE_BYTES = 8 * 1024

export class USBSerialOutputFullError extends Error {
  readonly code = 'USB_SERIAL_OUTPUT_FULL'

  constructor() {
    super('USB serial output full')
  }
}

export function isUSBSerialOutputFullError(error: unknown): error is USBSerialOutputFullError {
  return error instanceof USBSerialOutputFullError
}

export type USBSerialOptions = {
  format?: 'buffer'
  io?: unknown
  target?: unknown
  onReadable?(this: USBSerialIO, bytes: number): void
  onWritable?(this: USBSerialIO): void
  onError?(this: USBSerialIO): void
}

export type USBSerialIO = {
  readonly connected: boolean
  format: 'buffer'
  read(): ArrayBuffer | undefined
  read(maximumBytes: number): ArrayBuffer | undefined
  read(target: Uint8Array): number | undefined
  write(source: Uint8Array): void
  close(): void
}

export type USBSerialFactory = (options: USBSerialOptions) => USBSerialIO
