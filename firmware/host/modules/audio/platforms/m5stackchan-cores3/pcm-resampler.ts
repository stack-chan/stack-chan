export default function resamplePCM16Mono(
  this: unknown,
  input: ArrayBufferLike,
  inputOffset: number,
  inputCount: number,
  output: ArrayBufferLike,
  sourceSampleRate: number,
  targetSampleRate: number,
  state: Int32Array,
): number {
  return native('xs_resamplePCM16Mono').call(
    this,
    input,
    inputOffset,
    inputCount,
    output,
    sourceSampleRate,
    targetSampleRate,
    state.buffer,
  )
}
