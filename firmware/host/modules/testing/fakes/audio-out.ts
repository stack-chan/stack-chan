type AudioOutOptions = {
  streams: number
  bitsPerSample?: number
  sampleRate?: number
  numChannels?: number
}

let constructorFailure: unknown
const instances: AudioOut[] = []

export default class AudioOut {
  static readonly Samples = 1
  static readonly Flush = 2
  static readonly Callback = 3
  static readonly Volume = 4
  static readonly RawSamples = 5
  static readonly Tone = 6
  static readonly Silence = 7
  callbacks: Array<((value: number) => void) | null> = []
  closed = false
  enqueued: Array<{
    stream: number
    kind: number
    value: unknown
    repeat?: number
    offset?: number
    count?: number
  }> = []
  enqueueFailure: unknown
  stopFailure: unknown
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

  enqueue(stream: number, kind: number, value: unknown = 0, repeat?: number, offset?: number, count?: number): void {
    if (this.enqueueFailure !== undefined) throw this.enqueueFailure
    this.enqueued.push({ stream, kind, value, repeat, offset, count })
  }

  length(_stream: number): number {
    return 12
  }

  start(): void {
    this.started += 1
  }

  stop(): void {
    if (this.stopFailure !== undefined) throw this.stopFailure
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
