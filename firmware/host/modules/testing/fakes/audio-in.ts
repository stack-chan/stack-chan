type AudioInOptions = {
  channels?: number
  onReadable?: (this: AudioIn, size: number, sampleCount?: number) => void
}

let chunks: Array<ArrayBuffer | null> = []
let instances: AudioIn[] = []
let shouldThrowOnStart = false
let allocatingReadCount = 0

export default class AudioIn {
  bitsPerSample = 8
  channels = 1
  closed = false
  sampleRate = 1000
  started = false
  #onReadable?: AudioInOptions['onReadable']

  constructor(options: AudioInOptions = {}) {
    this.channels = options.channels ?? this.channels
    this.#onReadable = options.onReadable
    instances.push(this)
  }

  start(): void {
    if (shouldThrowOnStart) {
      throw new Error('start failed')
    }
    this.started = true
  }

  close(): void {
    this.closed = true
  }

  read(target: number | Uint8Array): ArrayBuffer | number | null {
    const chunk = chunks.shift() ?? null
    if (!chunk) return null
    if (typeof target === 'number') {
      allocatingReadCount += 1
      return chunk
    }
    const source = new Uint8Array(chunk)
    const byteLength = Math.min(source.byteLength, target.byteLength)
    target.set(source.subarray(0, byteLength))
    return byteLength
  }

  emitReadable(size: number): void {
    this.#onReadable?.call(this, size)
  }
}

export function resetAudioIn(nextChunks: Array<ArrayBuffer | null> = []): void {
  chunks = nextChunks
  instances = []
  shouldThrowOnStart = false
  allocatingReadCount = 0
}

export function getAudioInInstances(): AudioIn[] {
  return instances
}

export function setAudioInStartFailure(value: boolean): void {
  shouldThrowOnStart = value
}

export function getAllocatingReadCount(): number {
  return allocatingReadCount
}
