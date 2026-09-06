type Options = { streams: number; sampleRate?: number; bitsPerSample?: number; numChannels?: number }
export default class AudioOut {
  static readonly Flush = 1
  static readonly Volume = 2
  static readonly Tone = 3
  static readonly Callback = 4
  static readonly RawSamples = 5
  static readonly instances: AudioOut[] = []
  static constructorFailure = false
  static volumeFailure = false
  readonly sampleRate: number
  callback?: () => void
  started = 0
  stopped = 0
  closes = 0
  closesInCallback = 0
  inCallback = false
  closed = false
  closeFailure = false
  startFailure = false
  stopFailure = false
  constructor(options: Options) {
    if (AudioOut.constructorFailure) throw new Error('audio constructor failed')
    this.sampleRate = options.sampleRate ?? 24000
    AudioOut.instances.push(this)
  }
  enqueue(_stream: number, kind: number, ..._values: unknown[]) {
    if (kind === AudioOut.Volume && AudioOut.volumeFailure) throw new Error('volume setup failed')
  }
  start() {
    if (this.startFailure) throw new Error('audio start failed')
    this.started++
  }
  stop() {
    if (this.stopFailure) throw new Error('audio stop failed')
    this.stopped++
  }
  close() {
    this.closes++
    if (this.inCallback) this.closesInCallback++
    if (this.closeFailure) throw new Error('audio close failed')
    this.closed = true
  }
  deliver(callback = this.callback) {
    this.inCallback = true
    try {
      callback?.()
    } finally {
      this.inCallback = false
    }
  }
}
