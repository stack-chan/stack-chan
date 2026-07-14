export default function resamplePCM16Mono(
  inputBuffer: ArrayBufferLike,
  inputOffset: number,
  inputCount: number,
  outputBuffer: ArrayBufferLike,
  sourceSampleRate: number,
  targetSampleRate: number,
  state: Int32Array,
): number {
  const input = new Int16Array(inputBuffer, inputOffset * 2, inputCount)
  const output = new Int16Array(outputBuffer)
  if (inputCount === 0) return 0
  let inputStart = 0
  let previousSample: number
  if (state[2] === 0) {
    previousSample = input[0]
    inputStart = 1
    state[2] = 1
  } else {
    previousSample = state[1]
  }
  const available = inputCount - inputStart
  const inputEnd = available * targetSampleRate
  let phase = state[0]
  let outputCount = 0
  while (phase < inputEnd) {
    const inputIndex = Math.floor(phase / targetSampleRate)
    const fraction = phase % targetSampleRate
    const first = inputIndex === 0 ? previousSample : input[inputStart + inputIndex - 1]
    const second = input[inputStart + inputIndex]
    const weighted = first * (targetSampleRate - fraction) + second * fraction
    output[outputCount++] =
      weighted >= 0
        ? Math.floor((weighted + targetSampleRate / 2) / targetSampleRate)
        : Math.ceil((weighted - targetSampleRate / 2) / targetSampleRate)
    phase += sourceSampleRate
  }
  phase -= inputEnd
  state[0] = phase
  state[1] = input[inputCount - 1]
  return outputCount
}
