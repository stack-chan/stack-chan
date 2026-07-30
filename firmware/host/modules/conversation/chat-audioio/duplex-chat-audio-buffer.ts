export function ringReadableBytes(head: number, tail: number, capacity: number): number {
  if (!Number.isInteger(capacity) || capacity <= 0) throw new RangeError('ring capacity must be positive')
  if (!Number.isInteger(head) || head < 0 || head > capacity) throw new RangeError('ring head is out of range')
  if (!Number.isInteger(tail) || tail < 0 || tail >= capacity) throw new RangeError('ring tail is out of range')

  const normalizedHead = head === capacity ? 0 : head
  if (normalizedHead >= tail) return normalizedHead - tail
  return capacity - tail + normalizedHead
}

export function maximumSourceSamplesForOutput(
  outputSamples: number,
  sourceSampleRate: number,
  targetSampleRate: number,
): number {
  if (!Number.isInteger(outputSamples) || outputSamples < 0)
    throw new RangeError('output sample count must be nonnegative')
  if (!Number.isInteger(sourceSampleRate) || sourceSampleRate <= 0)
    throw new RangeError('source sample rate must be positive')
  if (!Number.isInteger(targetSampleRate) || targetSampleRate <= 0)
    throw new RangeError('target sample rate must be positive')

  return Math.floor((outputSamples * sourceSampleRate) / targetSampleRate)
}

export function copyCircularBytes(source: Uint8Array, sourceOffset: number, target: Uint8Array, count: number): number {
  if (!Number.isInteger(sourceOffset) || sourceOffset < 0 || sourceOffset >= source.byteLength)
    throw new RangeError('source offset is out of range')
  if (!Number.isInteger(count) || count < 0 || count > source.byteLength || count > target.byteLength)
    throw new RangeError('copy count is out of range')

  const first = Math.min(count, source.byteLength - sourceOffset)
  target.set(source.subarray(sourceOffset, sourceOffset + first), 0)
  if (first < count) target.set(source.subarray(0, count - first), first)
  return (sourceOffset + count) % source.byteLength
}

export const INPUT_GATE_CLOSED = 0
export const INPUT_GATE_OPEN = 1
export const INPUT_GATE_CLOSING = 2
export const INPUT_GATE_NO_CHANGE = 0
export const INPUT_GATE_SHOULD_OPEN = 1
export const INPUT_GATE_SHOULD_CLOSE = 2

/**
 * Tracks local speech activity using the mean absolute PCM level calculated by
 * ChatAudioIO. The worker owns the final CLOSING -> CLOSED transition after it
 * has sent the configured silence hangover.
 */
export class InputActivityGate {
  readonly threshold: number
  readonly attackSamples: number
  readonly hangoverSamples: number
  pendingSamples = 0
  remainingSamples = 0
  opens = 0
  closes = 0
  rejectedAttacks = 0
  maxLevel = 0

  constructor(threshold: number, attackSamples: number, hangoverSamples: number) {
    if (!Number.isInteger(threshold) || threshold <= 0) throw new RangeError('input gate threshold must be positive')
    if (!Number.isInteger(attackSamples) || attackSamples <= 0)
      throw new RangeError('input gate attack must be positive')
    if (!Number.isInteger(hangoverSamples) || hangoverSamples <= 0)
      throw new RangeError('input gate hangover must be positive')
    this.threshold = threshold
    this.attackSamples = attackSamples
    this.hangoverSamples = hangoverSamples
  }

  update(level: number, sampleCount: number, transportState: number): number {
    if (this.maxLevel < level) this.maxLevel = level

    if (level >= this.threshold) {
      if (transportState === INPUT_GATE_OPEN) {
        this.pendingSamples = 0
        this.remainingSamples = this.hangoverSamples
        return INPUT_GATE_NO_CHANGE
      }

      this.pendingSamples += sampleCount
      if (this.pendingSamples < this.attackSamples) return INPUT_GATE_NO_CHANGE
      this.pendingSamples = 0
      this.remainingSamples = this.hangoverSamples
      this.opens += 1
      return INPUT_GATE_SHOULD_OPEN
    }

    if (this.pendingSamples) {
      this.pendingSamples = 0
      this.rejectedAttacks += 1
    }
    if (transportState !== INPUT_GATE_OPEN) return INPUT_GATE_NO_CHANGE
    this.remainingSamples = Math.max(0, this.remainingSamples - sampleCount)
    if (this.remainingSamples > 0) return INPUT_GATE_NO_CHANGE

    this.closes += 1
    return INPUT_GATE_SHOULD_CLOSE
  }

  reset(): void {
    this.pendingSamples = 0
    this.remainingSamples = 0
    this.opens = 0
    this.closes = 0
    this.rejectedAttacks = 0
    this.maxLevel = 0
  }
}

/**
 * Fixed-size byte history that retains the newest bytes without allocating on
 * append. It is used for microphone pre-roll while the local input gate is
 * closed.
 */
export class CircularByteHistory {
  readonly bytes: Uint8Array
  head = 0
  length = 0

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) throw new RangeError('history capacity must be positive')
    this.bytes = new Uint8Array(new ArrayBuffer(capacity))
  }

  append(source: Uint8Array): void {
    const capacity = this.bytes.byteLength
    if (source.byteLength >= capacity) {
      this.bytes.set(source.subarray(source.byteLength - capacity))
      this.head = 0
      this.length = capacity
      return
    }

    const first = Math.min(source.byteLength, capacity - this.head)
    this.bytes.set(source.subarray(0, first), this.head)
    if (first < source.byteLength) this.bytes.set(source.subarray(first), 0)
    this.head = (this.head + source.byteLength) % capacity
    this.length = Math.min(capacity, this.length + source.byteLength)
  }

  drain(callback: (buffer: ArrayBufferLike, byteOffset: number, byteLength: number) => void): void {
    if (!this.length) return
    const capacity = this.bytes.byteLength
    const start = (this.head - this.length + capacity) % capacity
    const first = Math.min(this.length, capacity - start)
    callback(this.bytes.buffer, start, first)
    if (first < this.length) callback(this.bytes.buffer, 0, this.length - first)
    this.length = 0
  }

  clear(): void {
    this.head = 0
    this.length = 0
  }
}

/**
 * Generates a bounded, voiced diagnostic signal for exercising the microphone
 * gate and cloud input transport without driving the physical speaker.
 */
export class SyntheticInputProbe {
  readonly sampleRate: number
  readonly durationSamples: number
  readonly level: number
  readonly waveTable: Int16Array
  position = 0
  phase = 0

  constructor(sampleRate: number, durationMs: number, level: number) {
    if (!Number.isInteger(sampleRate) || sampleRate <= 0)
      throw new RangeError('input probe sample rate must be positive')
    if (!Number.isInteger(durationMs) || durationMs <= 0) throw new RangeError('input probe duration must be positive')
    if (!Number.isInteger(level) || level <= 0 || level > 16_000)
      throw new RangeError('input probe level must be from 1 through 16000')

    this.sampleRate = sampleRate
    this.durationSamples = Math.round((sampleRate * durationMs) / 1000)
    this.level = level
    this.waveTable = createInputProbeWaveTable()
  }

  fill(target: Int16Array): number {
    const samples = Math.min(target.length, this.durationSamples - this.position)
    for (let index = 0; index < samples; index += 1) {
      const segment = Math.floor((this.position * 4) / this.sampleRate) & 3
      const frequency = segment === 0 ? 137 : segment === 1 ? 173 : segment === 2 ? 149 : 191
      const tableIndex = Math.floor(this.phase) & (this.waveTable.length - 1)
      target[index] = Math.round((this.waveTable[tableIndex] * this.level) / 32767)
      this.phase += (frequency * this.waveTable.length) / this.sampleRate
      if (this.phase >= this.waveTable.length) this.phase -= this.waveTable.length
      this.position += 1
    }
    return samples
  }

  get done(): boolean {
    return this.position >= this.durationSamples
  }
}

function createInputProbeWaveTable(): Int16Array {
  const size = 256
  const raw = new Array<number>(size)
  let peak = 0
  for (let index = 0; index < size; index += 1) {
    const phase = (index * Math.PI * 2) / size
    const sample = Math.sin(phase) + Math.sin(phase * 2) * 0.45 + Math.sin(phase * 3) * 0.2
    raw[index] = sample
    peak = Math.max(peak, Math.abs(sample))
  }

  const table = new Int16Array(size)
  for (let index = 0; index < size; index += 1) table[index] = Math.round((raw[index] * 32767) / peak)
  return table
}
