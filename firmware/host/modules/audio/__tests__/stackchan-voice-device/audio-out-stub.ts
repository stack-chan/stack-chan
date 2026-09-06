import { state } from 'stackchan-voice-test-state'

type AudioOutOptions = {
  bitsPerSample: number
  channels: number
  onWritable: (size: number) => void
  sampleRate: number
}

export default class AudioOut {
  static instances: AudioOut[] = []
  static autoDeliver = true
  static failure: 'volume' | 'start' | 'stop' | 'close' | undefined
  closes = 0
  closesInCallback = 0
  #inCallback = false
  #volume = 1

  get volume() {
    return this.#volume
  }
  set volume(value: number) {
    if (AudioOut.failure === 'volume') throw new Error('volume failed')
    this.#volume = value
  }

  readonly #options: AudioOutOptions

  constructor(options: AudioOutOptions) {
    this.#options = options
    AudioOut.instances.push(this)
    state.audio.bitsPerSample = options.bitsPerSample
    state.audio.channels = options.channels
    state.audio.sampleRate = options.sampleRate
  }

  start(): void {
    state.audio.started += 1
    state.audio.volume = this.volume
    if (AudioOut.failure === 'start') throw new Error('start failed')
    if (AudioOut.autoDeliver) this.deliver()
  }

  deliver(): void {
    this.#inCallback = true
    try {
      this.#options.onWritable(4)
      this.#options.onWritable(4)
      this.#options.onWritable(4)
    } finally {
      this.#inCallback = false
    }
  }

  write(bytes: Uint8Array): void {
    state.audio.writesAreUint8Arrays.push(bytes instanceof Uint8Array)
    state.audio.writes.push(Array.from(bytes))
  }

  stop(): void {
    state.audio.stopped += 1
    if (AudioOut.failure === 'stop') throw new Error('stop failed')
  }

  close(): void {
    state.audio.closed += 1
    this.closes++
    if (this.#inCallback) this.closesInCallback++
    if (AudioOut.failure === 'close') throw new Error('close failed')
  }
}
