export function pcmMagnitudeSum(this: unknown, bytes: Uint8Array, offset: number, size: number): number {
  return native('xs_stackchan_pcm_magnitude_sum').call(this, bytes, offset, size)
}
