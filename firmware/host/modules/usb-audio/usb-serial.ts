import {
  USB_SERIAL_MAX_WRITE_BYTES,
  type USBSerialIO,
  type USBSerialOptions,
  USBSerialOutputFullError,
} from 'stackchan-usb-serial-types'

const nativeConstruct = native('xs_stackchan_usb_serial_constructor')
const nativeClose = native('xs_stackchan_usb_serial_close')
const nativeRead = native('xs_stackchan_usb_serial_read')
const nativeWrite = native('xs_stackchan_usb_serial_write')
const nativeGetConnected = native('xs_stackchan_usb_serial_get_connected')
const nativeGetFormat = native('xs_stackchan_usb_serial_get_format')
const nativeSetFormat = native('xs_stackchan_usb_serial_set_format')

export default class USBSerial extends Native('xs_stackchan_usb_serial_destructor') implements USBSerialIO {
  constructor(options: USBSerialOptions = {}) {
    super()
    nativeConstruct.call(this, options, USB_SERIAL_MAX_WRITE_BYTES)
  }

  close(): void {
    nativeClose.call(this)
  }

  read(): ArrayBuffer | undefined
  read(maximumBytes: number): ArrayBuffer | undefined
  read(target: Uint8Array): number | undefined
  read(target?: number | Uint8Array): ArrayBuffer | number | undefined {
    return target === undefined ? nativeRead.call(this) : nativeRead.call(this, target)
  }

  write(source: Uint8Array): void {
    if (!nativeWrite.call(this, source)) throw new USBSerialOutputFullError()
  }

  get connected(): boolean {
    return nativeGetConnected.call(this)
  }

  get format(): 'buffer' {
    return nativeGetFormat.call(this)
  }

  set format(value: 'buffer') {
    nativeSetFormat.call(this, value)
  }

  static {
    Object.defineProperty(USBSerial.prototype, Symbol.dispose, {
      value: USBSerial.prototype.close,
    })
  }
}
