const BYTES_PER_SAMPLE = 2
const MAX_TRACKS = 4
const MAX_TRACK_BUFFER_BYTES = 512 * 1024

type AudioOutCallback = (error?: unknown) => void

export type ModernAudioOutOptions = {
  sampleRate?: number
  bitsPerSample?: number
  channels?: number
  numChannels?: number
  onWritable?: (size: number) => void
}

export type ModernAudioOut = {
  readonly sampleRate: number
  readonly bitsPerSample: number
  readonly channels: number
  format: string
  volume: number
  write(samples: ArrayBuffer | ArrayBufferView, callback?: AudioOutCallback): void
  start(): void
  stop(): void
  close(): void
}

export type ModernAudioOutConstructor = new (options?: ModernAudioOutOptions) => ModernAudioOut

export type SharedAudioOutConstructor = ModernAudioOutConstructor & {
  Async: ModernAudioOutConstructor
}

type SharedAudioOutHooks = {
  onFormat?: (format: { sampleRate: number; bitsPerSample: number; channels: number }) => void
}

type QueueEntry = {
  remaining: number
  callback?: AudioOutCallback
}

function asBytes(samples: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (ArrayBuffer.isView(samples)) {
    return new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength)
  }
  return new Uint8Array(samples)
}

function nextCapacity(required: number): number {
  let capacity = 4096
  while (capacity < required) capacity *= 2
  if (capacity > MAX_TRACK_BUFFER_BYTES) throw new RangeError('shared AudioOut track buffer overflow')
  return capacity
}

function clampPCM16(value: number): number {
  if (value > 0x7fff) return 0x7fff
  if (value < -0x8000) return -0x8000
  return value
}

class AudioTrack {
  readonly owner: ModernAudioOut
  readonly manager: AudioMixer
  readonly asynchronous: boolean
  readonly onWritable?: (size: number) => void
  started = false
  closed = false
  volume = 1
  writeBudget = 0
  #buffer = new Uint8Array(0)
  #readOffset = 0
  #writeOffset = 0
  #byteLength = 0
  #entries: QueueEntry[] = []

  constructor(owner: ModernAudioOut, manager: AudioMixer, options: ModernAudioOutOptions, asynchronous: boolean) {
    this.owner = owner
    this.manager = manager
    this.asynchronous = asynchronous
    this.onWritable = options.onWritable
  }

  prepare(size: number): void {
    if (!this.started || this.closed || this.asynchronous) return
    this.writeBudget = size
    try {
      this.onWritable?.call(this.owner, size)
    } catch (error) {
      this.manager.reportError(error)
    }
  }

  enqueue(samples: ArrayBuffer | ArrayBufferView, callback?: AudioOutCallback): void {
    if (this.closed) throw new Error('AudioOut is closed')
    const source = asBytes(samples)
    if (source.byteLength % BYTES_PER_SAMPLE !== 0) throw new RangeError('full PCM16 samples only')
    if (source.byteLength === 0) {
      callback?.call(this.owner)
      return
    }
    if (!this.asynchronous) {
      if (source.byteLength > this.writeBudget) throw new Error('insufficient space')
      this.writeBudget -= source.byteLength
    }
    this.ensureCapacity(this.#byteLength + source.byteLength)
    const first = Math.min(source.byteLength, this.#buffer.byteLength - this.#writeOffset)
    this.#buffer.set(source.subarray(0, first), this.#writeOffset)
    this.#buffer.set(source.subarray(first), 0)
    this.#writeOffset = (this.#writeOffset + source.byteLength) % this.#buffer.byteLength
    this.#byteLength += source.byteLength
    this.#entries.push({ remaining: source.byteLength, callback })
  }

  consume(accumulator: Int32Array, requestedBytes: number, callbacks: AudioOutCallback[]): void {
    let use = Math.min(this.#byteLength, requestedBytes)
    use -= use % BYTES_PER_SAMPLE
    const samples = use / BYTES_PER_SAMPLE
    for (let index = 0; index < samples; index += 1) {
      const low = this.#buffer[this.#readOffset]
      this.#readOffset = (this.#readOffset + 1) % this.#buffer.byteLength
      const high = this.#buffer[this.#readOffset]
      this.#readOffset = (this.#readOffset + 1) % this.#buffer.byteLength
      let sample = low | (high << 8)
      if (sample & 0x8000) sample -= 0x1_0000
      accumulator[index] += Math.round(sample * this.volume)
    }
    this.#byteLength -= use
    this.completeEntries(use, callbacks)
  }

  discard(reason: Error): void {
    this.#readOffset = 0
    this.#writeOffset = 0
    this.#byteLength = 0
    for (const entry of this.#entries) {
      if (entry.callback) entry.callback.call(this.owner, reason)
    }
    this.#entries.length = 0
  }

  #ensureBufferWithExistingData(capacity: number): void {
    const replacement = new Uint8Array(capacity)
    if (this.#byteLength > 0) {
      const first = Math.min(this.#byteLength, this.#buffer.byteLength - this.#readOffset)
      replacement.set(this.#buffer.subarray(this.#readOffset, this.#readOffset + first), 0)
      replacement.set(this.#buffer.subarray(0, this.#byteLength - first), first)
    }
    this.#buffer = replacement
    this.#readOffset = 0
    this.#writeOffset = this.#byteLength
  }

  private ensureCapacity(required: number): void {
    if (required <= this.#buffer.byteLength) return
    this.#ensureBufferWithExistingData(nextCapacity(required))
  }

  private completeEntries(consumed: number, callbacks: AudioOutCallback[]): void {
    let remaining = consumed
    while (remaining > 0 && this.#entries.length > 0) {
      const entry = this.#entries[0]
      const use = Math.min(remaining, entry.remaining)
      entry.remaining -= use
      remaining -= use
      if (entry.remaining === 0) {
        this.#entries.shift()
        if (entry.callback) callbacks.push((error) => entry.callback?.call(this.owner, error))
      }
    }
  }
}

class AudioMixer {
  readonly physical: ModernAudioOut
  readonly sampleRate: number
  readonly bitsPerSample: number
  readonly channels: number
  readonly #onEmpty: () => void
  readonly #tracks: AudioTrack[] = []
  #running = false
  #closed = false
  #accumulator = new Int32Array(0)
  #output = new Uint8Array(0)

  constructor(
    PhysicalAudioOut: ModernAudioOutConstructor,
    options: ModernAudioOutOptions,
    hooks: SharedAudioOutHooks,
    onEmpty: () => void,
  ) {
    this.#onEmpty = onEmpty
    this.physical = new PhysicalAudioOut({
      sampleRate: options.sampleRate,
      bitsPerSample: options.bitsPerSample,
      channels: options.channels ?? options.numChannels,
      onWritable: (size) => this.onWritable(size),
    })
    this.sampleRate = this.physical.sampleRate
    this.bitsPerSample = this.physical.bitsPerSample
    this.channels = this.physical.channels
    if (this.bitsPerSample !== 16) {
      this.physical.close()
      throw new RangeError('shared AudioOut supports 16-bit PCM only')
    }
    this.physical.volume = 1
    hooks.onFormat?.({ sampleRate: this.sampleRate, bitsPerSample: this.bitsPerSample, channels: this.channels })
  }

  add(owner: ModernAudioOut, options: ModernAudioOutOptions, asynchronous: boolean): AudioTrack {
    const requestedChannels = options.channels ?? options.numChannels
    if (options.sampleRate !== undefined && options.sampleRate !== this.sampleRate)
      throw new Error('AudioOut sample rate conflict')
    if (options.bitsPerSample !== undefined && options.bitsPerSample !== this.bitsPerSample) {
      throw new Error('AudioOut bits-per-sample conflict')
    }
    if (requestedChannels !== undefined && requestedChannels !== this.channels)
      throw new Error('AudioOut channel conflict')
    if (this.#tracks.length >= MAX_TRACKS) throw new RangeError('too many shared AudioOut tracks')
    const track = new AudioTrack(owner, this, options, asynchronous)
    this.#tracks.push(track)
    return track
  }

  start(track: AudioTrack): void {
    if (track.closed || track.started) return
    track.started = true
    if (!this.#running) {
      this.#running = true
      this.physical.start()
    }
  }

  stop(track: AudioTrack): void {
    if (!track.started) return
    track.started = false
    track.writeBudget = 0
    track.discard(new Error('AudioOut stopped'))
    if (this.#running && !this.#tracks.some((candidate) => candidate.started)) {
      this.#running = false
      this.physical.stop()
    }
  }

  close(track: AudioTrack): void {
    if (track.closed) return
    this.stop(track)
    track.closed = true
    track.discard(new Error('AudioOut closed'))
    const index = this.#tracks.indexOf(track)
    if (index >= 0) this.#tracks.splice(index, 1)
    if (this.#tracks.length === 0) {
      this.#closed = true
      this.physical.close()
      this.#onEmpty()
    }
  }

  reportError(error: unknown): void {
    const global = globalThis as typeof globalThis & { trace?: (message: string) => void }
    global.trace?.(`[SharedAudioOut] ${String(error)}\n`)
  }

  private onWritable(rawSize: number): void {
    const size = rawSize - (rawSize % BYTES_PER_SAMPLE)
    if (size <= 0) return
    const sampleCount = size / BYTES_PER_SAMPLE
    if (this.#accumulator.length < sampleCount) this.#accumulator = new Int32Array(sampleCount)
    if (this.#output.byteLength < size) this.#output = new Uint8Array(size)
    this.#accumulator.fill(0, 0, sampleCount)

    for (const track of [...this.#tracks]) track.prepare(size)
    if (this.#closed || this.#tracks.length === 0) return

    const callbacks: AudioOutCallback[] = []
    for (const track of this.#tracks) {
      if (track.started && !track.closed) track.consume(this.#accumulator, size, callbacks)
    }

    const view = new DataView(this.#output.buffer)
    for (let index = 0; index < sampleCount; index += 1) {
      view.setInt16(index * BYTES_PER_SAMPLE, clampPCM16(this.#accumulator[index]), true)
    }
    try {
      this.physical.write(this.#output.subarray(0, size))
      for (const callback of callbacks) callback()
    } catch (error) {
      for (const callback of callbacks) callback(error)
      this.reportError(error)
    }
  }
}

export function createSharedAudioOutClass(
  PhysicalAudioOut: ModernAudioOutConstructor,
  hooks: SharedAudioOutHooks = {},
): SharedAudioOutConstructor {
  let mixer: AudioMixer | undefined

  class SharedAudioOut implements ModernAudioOut {
    static Async: ModernAudioOutConstructor
    readonly #track: AudioTrack

    constructor(options: ModernAudioOutOptions = {}, asynchronous = false) {
      const created = mixer === undefined
      const current = mixer ?? new AudioMixer(PhysicalAudioOut, options, hooks, () => (mixer = undefined))
      if (created) mixer = current
      try {
        this.#track = current.add(this, options, asynchronous)
      } catch (error) {
        if (created) {
          current.physical.close()
          mixer = undefined
        }
        throw error
      }
    }

    get sampleRate(): number {
      return this.#track.manager.sampleRate
    }

    get bitsPerSample(): number {
      return this.#track.manager.bitsPerSample
    }

    get channels(): number {
      return this.#track.manager.channels
    }

    get format(): string {
      return 'buffer'
    }

    set format(value: string) {
      if (value !== 'buffer') throw new RangeError('invalid format')
    }

    get volume(): number {
      return this.#track.volume
    }

    set volume(value: number) {
      if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError('invalid volume')
      this.#track.volume = value
    }

    write(samples: ArrayBuffer | ArrayBufferView, callback?: AudioOutCallback): void {
      this.#track.enqueue(samples, callback)
    }

    start(): void {
      this.#track.manager.start(this.#track)
    }

    stop(): void {
      this.#track.manager.stop(this.#track)
    }

    close(): void {
      this.#track.manager.close(this.#track)
    }
  }

  class AsyncSharedAudioOut extends SharedAudioOut {
    constructor(options: ModernAudioOutOptions = {}) {
      super(options, true)
    }
  }

  SharedAudioOut.Async = AsyncSharedAudioOut
  return SharedAudioOut as SharedAudioOutConstructor
}
