type AudioOutOptions = {
  streams: number
  bitsPerSample?: number
  sampleRate?: number
  numChannels?: number
}

let constructorFailure: unknown
const instances: AudioOut[] = []

export default class AudioOut {
  static readonly Volume = 4
  closed = false
  enqueued: Array<{ stream: number; kind: number; value: number }> = []
  options: AudioOutOptions
  started = 0
  stopped = 0

  constructor(options: AudioOutOptions) {
    if (constructorFailure !== undefined) {
      throw constructorFailure
    }
    this.options = options
    instances.push(this)
  }

  enqueue(stream: number, kind: number, value: number): void {
    this.enqueued.push({ stream, kind, value })
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
}

export function getAudioOutInstances(): AudioOut[] {
  return instances
}

export function resetAudioOut(): void {
  constructorFailure = undefined
  instances.length = 0
}

export function setAudioOutConstructorFailure(error: unknown): void {
  constructorFailure = error
}
