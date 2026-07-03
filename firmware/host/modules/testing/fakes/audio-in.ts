type AudioInOptions = {
  onReadable?: (this: AudioIn, size: number, sampleCount?: number) => void
}

let chunks: Array<ArrayBuffer | null> = []
let instances: AudioIn[] = []
let shouldThrowOnStart = false

export default class AudioIn {
  bitsPerSample = 8
  channels = 1
  closed = false
  sampleRate = 1000
  started = false
  #onReadable?: AudioInOptions['onReadable']

  constructor(options: AudioInOptions = {}) {
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

  read(_size: number): ArrayBuffer | null {
    return chunks.shift() ?? null
  }

  emitReadable(size: number): void {
    this.#onReadable?.call(this, size)
  }
}

export function resetAudioIn(nextChunks: Array<ArrayBuffer | null> = []): void {
  chunks = nextChunks
  instances = []
  shouldThrowOnStart = false
}

export function getAudioInInstances(): AudioIn[] {
  return instances
}

export function setAudioInStartFailure(value: boolean): void {
  shouldThrowOnStart = value
}
