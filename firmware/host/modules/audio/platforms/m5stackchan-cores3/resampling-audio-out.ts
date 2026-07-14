import AudioOut from 'embedded:io/audio/out'

const OUTPUT_SAMPLE_RATE = 24000
const AUDIO_QUEUE_LENGTH = 48

type SharedOutputRing = {
  readableView(maximum?: number): Uint8Array
  advanceRead(count: number): void
}
type ECMA419AudioOut = {
  readonly sampleRate: number
  volume: number
  write(buffer: Uint8Array): void
  start(): void
  stop(): void
  close(): void
}

type ECMA419AudioOutConstructor = new (options: {
  bitsPerSample: 16
  channels: 1
  sampleRate: number
  onWritable(size: number): void
}) => ECMA419AudioOut

type AudioOutOptions = {
  streams?: number
  bitsPerSample?: number
  numChannels?: number
  sampleRate?: number
}

/**
 * AudioOut facade for CoreS3 WebRadio.
 *
 * CoreS3 cannot reliably clock the AW88298 at 44.1 kHz. The Core 1 worker
 * converts WebRadio PCM to 24 kHz and this facade drains its shared ring into
 * the ECMA-419 AudioOut FIFO.
 */
export default class ResamplingAudioOut {
  static readonly Samples = 1
  static readonly Flush = 2
  static readonly Callback = 3
  static readonly Volume = 4
  static readonly RawSamples = 5
  static readonly Tone = 6
  static readonly Silence = 7

  readonly sampleRate = OUTPUT_SAMPLE_RATE
  readonly numChannels = 1
  readonly bitsPerSample = 16
  readonly streams = 1

  #audio: ECMA419AudioOut
  #sharedOutput: SharedOutputRing | undefined
  #sharedCompletion: Int32Array | undefined
  #onSharedOutputWritten: (() => void) | undefined
  #writableBytes = 0
  #closed = false
  #started = false

  constructor(_options: AudioOutOptions) {
    const Output = AudioOut as unknown as ECMA419AudioOutConstructor
    this.#audio = new Output({
      bitsPerSample: 16,
      channels: 1,
      sampleRate: OUTPUT_SAMPLE_RATE,
      onWritable: (size) => this.#onWritable(size),
    })
    // ECMA-419 AudioOut starts at full scale. Keep the output muted until the
    // WebRadio player applies its validated, host-limited volume.
    this.#audio.volume = 0
    const amp = (globalThis as typeof globalThis & { amp?: { sampleRate: number } }).amp
    if (amp) amp.sampleRate = OUTPUT_SAMPLE_RATE
  }

  /**
   * Attach the single-producer PCM ring filled by the Core 1 decoder worker.
   * The completion counter advances after bytes have entered the ECMA-419
   * AudioOut FIFO, allowing the worker to release decoded MP3 frames without
   * a message for every PCM batch.
   */
  attachSharedOutput(output: SharedOutputRing, completion: Int32Array, onWritten: () => void): void {
    if (this.#closed) throw new Error('AudioOut is closed')
    if (completion.length < 1) throw new RangeError('Shared output completion state is too small')
    this.#sharedOutput = output
    this.#sharedCompletion = completion
    this.#onSharedOutputWritten = onWritten
    Atomics.store(completion, 0, 0)
    if (this.#started) this.#drainWritable()
  }

  detachSharedOutput(output: SharedOutputRing): void {
    if (this.#sharedOutput !== output) return
    this.#sharedOutput = undefined
    this.#sharedCompletion = undefined
    this.#onSharedOutputWritten = undefined
  }

  pumpSharedOutput(): void {
    if (this.#started) this.#drainWritable()
  }

  enqueue(_stream: number, kind: number, value?: unknown): this {
    if (kind === ResamplingAudioOut.Flush) return this
    if (kind === ResamplingAudioOut.Volume) {
      const volume = Number(value ?? 0) / 256
      this.#audio.volume = Math.max(0, Math.min(1, volume))
      return this
    }
    throw new Error(`Unsupported CoreS3 WebRadio audio command: ${kind}`)
  }

  #onWritable(size: number): void {
    if (this.#closed) return
    this.#writableBytes = size
    this.#drainWritable()
  }

  #drainWritable(): void {
    let sharedWritten = 0
    while (this.#writableBytes >= 2) {
      const output = this.#sharedOutput
      const completion = this.#sharedCompletion
      if (!output || !completion) break
      const source = output.readableView(this.#writableBytes)
      const use = source.byteLength & ~1
      if (!use) break
      const samples = use === source.byteLength ? source : source.subarray(0, use)
      this.#audio.write(samples)
      output.advanceRead(use)
      Atomics.add(completion, 0, use)
      this.#writableBytes -= use
      sharedWritten += use
    }
    if (sharedWritten) this.#onSharedOutputWritten?.()
  }

  length(stream: number): number {
    return stream === 0 ? AUDIO_QUEUE_LENGTH : 0
  }

  mix(): never {
    throw new Error('mix is unavailable on CoreS3 WebRadio output')
  }

  start(): void {
    this.#started = true
    this.#audio.start()
    this.#drainWritable()
  }

  stop(): void {
    this.#started = false
    this.#audio.stop()
    this.#writableBytes = 0
  }

  close(): void {
    this.#closed = true
    this.#audio.close()
    this.#writableBytes = 0
    this.#sharedOutput = undefined
    this.#sharedCompletion = undefined
    this.#onSharedOutputWritten = undefined
  }
}
