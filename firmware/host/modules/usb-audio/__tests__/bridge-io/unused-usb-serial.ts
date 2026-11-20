import type { USBSerialIO, USBSerialOptions } from 'stackchan-usb-serial-types'

export default class UnusedUSBSerial implements USBSerialIO {
  readonly connected = false
  format: 'buffer' = 'buffer'

  constructor(options: USBSerialOptions) {
    if (options.format !== undefined && options.format !== 'buffer') throw new RangeError('unsupported format')
  }

  read(): undefined {
    return
  }

  write(_source: Uint8Array): void {
    throw new Error('native USB serial is unavailable in the lin bridge test')
  }

  close(): void {}
}
