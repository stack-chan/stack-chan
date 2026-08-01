export function crc32Usb(source: Uint8Array, end = source.byteLength): number {
  return native('xs_stackchan_usb_crc32').call(this, source, end)
}
