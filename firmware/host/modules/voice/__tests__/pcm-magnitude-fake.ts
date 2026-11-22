export function pcmMagnitudeSum(bytes: Uint8Array, offset: number, size: number): number {
  const samples = new DataView(bytes.buffer, bytes.byteOffset + offset, size)
  let magnitude = 0
  for (let i = 0; i < size; i += 2) {
    magnitude += Math.abs(samples.getInt16(i, true))
  }
  return magnitude
}
