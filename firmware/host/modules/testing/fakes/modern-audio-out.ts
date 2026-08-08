type AudioOutOptions = {
  sampleRate?: number
  bitsPerSample?: number
  channels?: number
  numChannels?: number
  onWritable?: (size: number) => void
}

let constructorFailure: unknown
const instances: ModernAudioOut[] = []

export default class ModernAudioOut {
  readonly sampleRate: number
  readonly bitsPerSample: number
  readonly channels: number
  readonly writes: Uint8Array[] = []
  readonly #onWritable?: (size: number) => void
  format = 'buffer'
  volume = 1
  started = 0
  stopped = 0
  closed = false

  constructor(options: AudioOutOptions = {}) {
    if (constructorFailure !== undefined) throw constructorFailure
    this.sampleRate = options.sampleRate ?? 24_000
    this.bitsPerSample = options.bitsPerSample ?? 16
    this.channels = options.channels ?? options.numChannels ?? 1
    this.#onWritable = options.onWritable
    instances.push(this)
  }

  write(samples: ArrayBuffer | ArrayBufferView): void {
    const bytes = ArrayBuffer.isView(samples)
      ? new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength)
      : new Uint8Array(samples)
    this.writes.push(new Uint8Array(bytes))
  }

  start(): void {
    this.started += 1
  }

  stop(): void {
    this.stopped += 1
  }

  close(): void {
    this.closed = true
  }

  emitWritable(size: number): void {
    this.#onWritable?.call(this, size)
  }
}

export function getModernAudioOutInstances(): ModernAudioOut[] {
  return instances
}

export function setModernAudioOutConstructorFailure(error: unknown): void {
  constructorFailure = error
}

export function resetModernAudioOut(): void {
  constructorFailure = undefined
  instances.length = 0
}
