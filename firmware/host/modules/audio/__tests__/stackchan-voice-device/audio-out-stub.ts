import { state } from 'stackchan-voice-test-state'

type AudioOutOptions = {
  bitsPerSample: number
  channels: number
  onWritable: (size: number) => void
  sampleRate: number
}

export default class AudioOut {
  volume = 1

  readonly #options: AudioOutOptions

  constructor(options: AudioOutOptions) {
    this.#options = options
    state.audio.bitsPerSample = options.bitsPerSample
    state.audio.channels = options.channels
    state.audio.sampleRate = options.sampleRate
  }

  start(): void {
    state.audio.started += 1
    state.audio.volume = this.volume
    this.#options.onWritable(4)
    this.#options.onWritable(4)
    this.#options.onWritable(4)
  }

  write(bytes: Uint8Array): void {
    state.audio.writesAreUint8Arrays.push(bytes instanceof Uint8Array)
    state.audio.writes.push(Array.from(bytes))
  }

  stop(): void {
    state.audio.stopped += 1
  }

  close(): void {
    state.audio.closed += 1
  }
}
