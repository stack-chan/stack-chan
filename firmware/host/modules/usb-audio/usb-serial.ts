export function openUsbSerial(): void {
  native('xs_stackchan_usb_serial_open').call(this)
}

export function readUsbSerial(target: Uint8Array): number {
  return native('xs_stackchan_usb_serial_read').call(this, target)
}

export function writeUsbSerial(source: Uint8Array): number {
  return native('xs_stackchan_usb_serial_write').call(this, source)
}

export function isUsbSerialConnected(): boolean {
  return native('xs_stackchan_usb_serial_is_connected').call(this)
}

export function crc32UsbSerial(source: Uint8Array, end = source.byteLength): number {
  return native('xs_stackchan_usb_crc32').call(this, source, end)
}

export function closeUsbSerial(): void {
  native('xs_stackchan_usb_serial_close').call(this)
}
