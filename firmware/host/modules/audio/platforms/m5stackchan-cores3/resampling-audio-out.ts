import AudioOut from 'embedded:io/audio/out'
import resamplePCM16Mono from 'pcm-resampler'

const OUTPUT_SAMPLE_RATE = 24000
const WRITE_QUEUE_LENGTH = 48

type AudioBuffer = ArrayBuffer | SharedArrayBuffer | Uint8Array
type SharedOutputRing = {
  readableView(maximum?: number): Uint8Array
  advanceRead(count: number): void
}
type ECMA419AudioOut = {
  readonly sampleRate: number
  volume: number
  write(buffer: AudioBuffer): void
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

type Completion = {
  callbackValue?: number
  completed: boolean
}

type QueuedWrite = {
  buffer: ArrayBuffer | SharedArrayBuffer
  end: number
  position: number
  completion: Completion
  recyclable: boolean
}

type AudioOutOptions = {
  streams?: number
  bitsPerSample?: number
  numChannels?: number
  sampleRate?: number
}

/**
 * AudioOut facade for CoreS3 WebRadio.
 *
 * CoreS3 cannot reliably clock the AW88298 at 44.1 kHz. The WebRadio worker
 * normally supplies mono 16-bit PCM already converted to 24 kHz, which this
 * facade forwards without copying. The stateful converter remains as a
 * fallback for callers that supply PCM at another rate.
 */
export default class ResamplingAudioOut {
  static readonly Samples = 1
  static readonly Flush = 2
  static readonly Callback = 3
  static readonly Volume = 4
  static readonly RawSamples = 5
  static readonly Tone = 6
  static readonly Silence = 7

  readonly callbacks: Array<(value: number) => void> = []
  callback: (value: number) => void = () => {}
  readonly sampleRate = OUTPUT_SAMPLE_RATE
  readonly numChannels = 1
  readonly bitsPerSample = 16
  readonly streams = 1

  #audio: ECMA419AudioOut
  #sourceSampleRate: number
  #resamplerState = new Int32Array(new SharedArrayBuffer(3 * Int32Array.BYTES_PER_ELEMENT))
  #free: SharedArrayBuffer[] = []
  #queue: QueuedWrite[] = []
  #sharedOutput: SharedOutputRing | undefined
  #sharedCompletion: Int32Array | undefined
  #onSharedOutputWritten: (() => void) | undefined
  #writableBytes = 0
  #lastCompletion: Completion | undefined
  #closed = false
  #started = false

  constructor(options: AudioOutOptions) {
    this.#sourceSampleRate = options.sampleRate ?? 44100
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

  enqueue(stream: number, kind: number, value?: unknown, repeat?: number, offset?: number, count?: number): this {
    if (kind === ResamplingAudioOut.Flush) return this
    if (kind === ResamplingAudioOut.Volume) {
      const volume = Number(value ?? 0) / 256
      this.#audio.volume = Math.max(0, Math.min(1, volume))
      return this
    }
    if (kind === ResamplingAudioOut.Callback) {
      if (!this.#lastCompletion) throw new Error('Callback requires a preceding RawSamples buffer')
      this.#lastCompletion.callbackValue = Number(value ?? 0)
      this.#deliverCompletion(this.#lastCompletion)
      return this
    }
    if (kind !== ResamplingAudioOut.RawSamples) {
      throw new Error(`Unsupported CoreS3 WebRadio audio command: ${kind}`)
    }
    if (this.#closed) throw new Error('AudioOut is closed')
    if (this.#queue.length >= WRITE_QUEUE_LENGTH) {
      throw new Error('CoreS3 WebRadio audio queue is full')
    }
    if (repeat !== undefined && repeat !== 1) {
      throw new Error('CoreS3 WebRadio does not support repeated PCM buffers')
    }
    if (stream !== 0) throw new Error('CoreS3 WebRadio supports one audio stream')
    if (!(value instanceof ArrayBuffer || value instanceof SharedArrayBuffer)) {
      throw new TypeError('RawSamples requires an ArrayBuffer')
    }

    const inputOffset = offset ?? 0
    const inputCount = count ?? Math.floor(value.byteLength / 2) - inputOffset
    const completion: Completion = { completed: false }
    this.#lastCompletion = completion
    if (this.#sourceSampleRate === OUTPUT_SAMPLE_RATE) {
      this.#queue.push({
        buffer: value,
        end: (inputOffset + inputCount) * 2,
        position: inputOffset * 2,
        completion,
        recyclable: false,
      })
    } else {
      const maximumOutputCount =
        Math.floor((inputCount * OUTPUT_SAMPLE_RATE + this.#sourceSampleRate - 1) / this.#sourceSampleRate) + 1
      let outputBuffer = this.#free.shift()
      if (!outputBuffer || outputBuffer.byteLength < maximumOutputCount * 2) {
        outputBuffer = new SharedArrayBuffer(maximumOutputCount * 2)
      }
      const outputCount = resamplePCM16Mono(
        value,
        inputOffset,
        inputCount,
        outputBuffer,
        this.#sourceSampleRate,
        OUTPUT_SAMPLE_RATE,
        this.#resamplerState,
      )
      this.#queue.push({
        buffer: outputBuffer,
        end: outputCount * 2,
        position: 0,
        completion,
        recyclable: true,
      })
    }
    if (this.#started) this.#drainWritable()
    return this
  }

  #onWritable(size: number): void {
    if (this.#closed) return
    this.#writableBytes = size
    this.#drainWritable()
  }

  #drainWritable(): void {
    let sharedWritten = 0
    while (this.#writableBytes >= 2) {
      if (this.#queue.length) {
        const entry = this.#queue[0]
        let use = Math.min(this.#writableBytes, entry.end - entry.position)
        use &= ~1
        if (!use) break
        this.#audio.write(new Uint8Array(entry.buffer, entry.position, use))
        entry.position += use
        this.#writableBytes -= use
        if (entry.position !== entry.end) continue

        this.#queue.shift()
        if (entry.recyclable) this.#free.push(entry.buffer as SharedArrayBuffer)
        entry.completion.completed = true
        this.#deliverCompletion(entry.completion)
        continue
      }

      const output = this.#sharedOutput
      const completion = this.#sharedCompletion
      if (!output || !completion) break
      const source = output.readableView(this.#writableBytes)
      const use = source.byteLength & ~1
      if (!use) break
      const samples = use === source.byteLength ? source : new Uint8Array(source.buffer, source.byteOffset, use)
      this.#audio.write(samples)
      output.advanceRead(use)
      Atomics.add(completion, 0, use)
      this.#writableBytes -= use
      sharedWritten += use
    }
    if (sharedWritten) this.#onSharedOutputWritten?.()
  }

  #deliverCompletion(completion: Completion): void {
    if (!completion.completed || completion.callbackValue === undefined) {
      return
    }
    this.callbacks[0]?.(completion.callbackValue)
  }

  length(stream: number): number {
    if (stream !== 0) return 0
    return WRITE_QUEUE_LENGTH - this.#queue.length
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
    this.#queue.length = 0
    this.#writableBytes = 0
    this.#free.length = 0
    this.#sharedOutput = undefined
    this.#sharedCompletion = undefined
    this.#onSharedOutputWritten = undefined
  }
}
