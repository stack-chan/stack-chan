export type XsVersionRange = readonly [number, number, number, number]

export type ModFlash = {
  readonly byteLength: number
  readonly blockSize: number
  erase(sector: number): void
  write(offset: number, byteLength: number, buffer: Uint8Array): void
  read(offset: number, byteLength: number): ArrayBuffer
}

export function validateXsaArchive(
  buffer: ArrayBuffer,
  maximumBytes: number,
  [minimumMajor, minimumMinor, maximumMajor, maximumMinor]: XsVersionRange,
): Uint8Array {
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  if (bytes.byteLength < 20 || view.getUint32(4, false) !== 0x58535f41 /* XS_A */) {
    throw new Error('invalid XSA archive header')
  }
  if (view.getUint32(0, false) !== bytes.byteLength) throw new Error('XSA archive size does not match its header')
  if (view.getUint32(8, false) !== 12 || view.getUint32(12, false) !== 0x56455253 /* VERS */) {
    throw new Error('invalid XSA version atom')
  }
  const version = (bytes[16] << 8) | bytes[17]
  const minimum = (minimumMajor << 8) | minimumMinor
  const maximum = (maximumMajor << 8) | maximumMinor
  if (version < minimum || version > maximum) throw new Error('incompatible XSA version')
  if (bytes.byteLength > maximumBytes) throw new Error('XSA archive exceeds the xs partition')
  return bytes
}

export function writeAndVerifyXsaArchive(bytes: Uint8Array, flash: ModFlash): void {
  const sectorCount = Math.ceil(bytes.byteLength / flash.blockSize)
  for (let sector = 0; sector < sectorCount; sector += 1) flash.erase(sector)
  flash.write(0, bytes.byteLength, bytes)

  for (let offset = 0; offset < bytes.byteLength; offset += flash.blockSize) {
    const byteLength = Math.min(flash.blockSize, bytes.byteLength - offset)
    const written = new Uint8Array(flash.read(offset, byteLength))
    for (let index = 0; index < byteLength; index += 1) {
      if (written[index] !== bytes[offset + index]) {
        throw new Error(`XSA flash verification failed at ${offset + index}`)
      }
    }
  }
}
