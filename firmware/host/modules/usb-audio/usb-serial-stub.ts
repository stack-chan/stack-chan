export function openUsbSerial(): void {}
export function readUsbSerial(_target: Uint8Array): number {
  return 0
}
export function writeUsbSerial(source: Uint8Array): number {
  return source.byteLength
}
export function isUsbSerialConnected(): boolean {
  return false
}
export function closeUsbSerial(): void {}
