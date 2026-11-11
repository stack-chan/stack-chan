export function pcmEnergy(bytes: Uint8Array, offset: number, size: number): number {
  return native('xs_stackchan_pcm_energy').call(null, bytes, offset, size)
}
