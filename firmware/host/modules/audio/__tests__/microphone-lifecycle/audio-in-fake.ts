type Options = {
  channels?: number
  onReadable?: (this: AudioIn, size: number, sampleCount?: number) => void
}

export default class AudioIn {
  static instances: AudioIn[] = []
  static failConstructor = false
  static failStart = false
  static format = { sampleRate: 1000, bitsPerSample: 16 }
  readonly sampleRate: number
  readonly bitsPerSample: number
  readonly channels: number
  closes = 0
  closesInCallback = 0
  #delivering = false
  reads = 0
  closeFailure = false
  chunks: Array<ArrayBuffer | undefined> = []
  onClose?: () => void
  readonly #options: Options

  constructor(options: Options) {
    if (AudioIn.failConstructor) throw new Error('constructor failed')
    this.#options = options
    this.channels = options.channels ?? 2
    this.sampleRate = AudioIn.format.sampleRate
    this.bitsPerSample = AudioIn.format.bitsPerSample
    AudioIn.instances.push(this)
  }
  start() {
    if (AudioIn.failStart) throw new Error('start failed')
  }
  close() {
    this.closes++
    if (this.#delivering) this.closesInCallback++
    this.onClose?.()
    if (this.closeFailure) throw new Error('input close failed')
  }
  read(_requested: number): ArrayBuffer | undefined {
    this.reads++
    return this.chunks.shift()
  }
  readable(size: number) {
    this.#delivering = true
    try {
      this.#options.onReadable?.call(this, size)
    } finally {
      this.#delivering = false
    }
  }
}
