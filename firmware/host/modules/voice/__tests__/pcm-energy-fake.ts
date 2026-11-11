export function pcmEnergy(bytes: Uint8Array, offset: number, size: number): number {
  const samples = new DataView(bytes.buffer, bytes.byteOffset + offset, size)
  let energy = 0
  for (let i = 0; i < size; i += 2) {
    const sample = samples.getInt16(i, true)
    energy += sample * sample
  }
  return energy
}
