export function pcmLevel(bytes: Uint8Array): number {
  if (bytes.length < 2) return 0
  let sum = 0
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let offset = 0; offset + 1 < bytes.length; offset += 2) sum += Math.abs(view.getInt16(offset, true))
  return sum / (Math.floor(bytes.length / 2) * 32768)
}
