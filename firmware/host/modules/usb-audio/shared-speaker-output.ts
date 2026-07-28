import type {
  UsbAudioSpeakerOutput,
  UsbAudioSpeakerOutputFactory,
  UsbAudioSpeakerOutputOptions,
} from 'stackchan-usb-audio-core'
import { SharedByteRing, type SharedByteRingBuffers } from 'web-radio-byte-ring'

export const SPEAKER_STATS_WRITTEN_BYTES = 0
export const SPEAKER_STATS_WRITABLE_CALLBACKS = 1
export const SPEAKER_STATS_MAX_WRITABLE_GAP_MS = 2
export const SPEAKER_STATS_WRITABLE_BYTES = 3
export const SPEAKER_STATS_AUDIO_ACTIVE = 4
export const SPEAKER_STATS_AWAITING_DRAIN = 5
export const SPEAKER_STATS_WORDS = 6

export type SharedSpeakerOutputBuffers = {
  ring: SharedByteRingBuffers
  stats: SharedArrayBuffer
}

type PostMessage = (message: Record<string, unknown>) => void

class SharedSpeakerOutput implements UsbAudioSpeakerOutput {
  readonly #ring: SharedByteRing
  readonly #stats: Int32Array
  readonly #postMessage: PostMessage
  readonly #options: UsbAudioSpeakerOutputOptions
  #closed = false
  #finished = false
  #failed = false
  #opened = false
  #startPosted = false
  #started = false
  #volume = 1
  #writtenBytes = 0

  constructor(
    ring: SharedByteRing,
    stats: Int32Array,
    postMessage: PostMessage,
    options: UsbAudioSpeakerOutputOptions,
  ) {
    this.#ring = ring
    this.#stats = stats
    this.#postMessage = postMessage
    this.#options = options
    postMessage({ id: 'audio-open', sampleRate: options.sampleRate, streamId: options.streamId })
  }

  get streamId(): number {
    return this.#options.streamId
  }

  get volume(): number {
    return this.#volume
  }

  set volume(value: number) {
    this.#volume = value
    this.#postMessage({ id: 'audio-volume', volume: value, streamId: this.streamId })
  }

  get bufferedBytes(): number {
    return this.#ring.readableBytes
  }

  get physicalWrittenBytes(): number {
    return Atomics.load(this.#stats, SPEAKER_STATS_WRITTEN_BYTES) >>> 0
  }

  get physicalWritableBytes(): number {
    return Atomics.load(this.#stats, SPEAKER_STATS_WRITABLE_BYTES) >>> 0
  }

  get physicalWritableCallbacks(): number {
    return Atomics.load(this.#stats, SPEAKER_STATS_WRITABLE_CALLBACKS) >>> 0
  }

  get physicalMaxWritableGapMilliseconds(): number {
    return Atomics.load(this.#stats, SPEAKER_STATS_MAX_WRITABLE_GAP_MS) >>> 0
  }

  get physicalAudioActive(): boolean {
    return Atomics.load(this.#stats, SPEAKER_STATS_AUDIO_ACTIVE) !== 0
  }

  get physicalAwaitingDrain(): boolean {
    return Atomics.load(this.#stats, SPEAKER_STATS_AWAITING_DRAIN) !== 0
  }

  get writtenBytes(): number {
    return this.#writtenBytes
  }

  start(): void {
    if (this.#closed || this.#started) return
    this.#started = true
  }

  poll(): void {
    if (!this.#opened || !this.#started || this.#closed || this.#finished) return
    const writable = this.#ring.writableBytes & ~1
    if (writable > 0) this.#options.onWritable.call(this, writable)
    if (this.#ring.readableBytes === 0) return
    if (!this.#startPosted) {
      this.#startPosted = true
      this.#postMessage({ id: 'audio-start', streamId: this.streamId })
    }
  }

  write(payload: Uint8Array): void {
    if (this.#closed || this.#finished) throw new Error('shared speaker output is closed')
    if (!this.#opened) throw new Error('shared speaker output is not open')
    if (!this.#started) throw new Error('shared speaker output is not started')
    if (payload.byteLength > this.#ring.writableBytes) throw new Error('shared speaker output is full')
    let offset = 0
    while (offset < payload.byteLength) {
      const target = this.#ring.writableView(payload.byteLength - offset)
      target.set(payload.subarray(offset, offset + target.byteLength))
      this.#ring.advanceWrite(target.byteLength)
      offset += target.byteLength
    }
    this.#writtenBytes += payload.byteLength
  }

  finish(): void {
    if (this.#closed || this.#finished) return
    this.#finished = true
    this.#postMessage({ id: 'audio-end', streamId: this.streamId })
  }

  handleDrained(): void {
    if (!this.#finished || this.#closed) return
    this.#options.onDrained.call(this)
  }

  handleOpened(): void {
    if (this.#closed || this.#opened) return
    this.#opened = true
  }

  handleFailed(): void {
    if (this.#closed || this.#failed) return
    this.#failed = true
    this.#options.onError.call(this)
  }

  stop(): void {
    this.close()
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#postMessage({ id: 'audio-close', streamId: this.streamId })
  }
}

export class SharedSpeakerOutputService {
  readonly #ring: SharedByteRing
  readonly #stats: Int32Array
  readonly #postMessage: PostMessage
  #current: SharedSpeakerOutput | undefined

  constructor(buffers: SharedSpeakerOutputBuffers, postMessage: PostMessage) {
    this.#ring = new SharedByteRing(buffers.ring.data, buffers.ring.state)
    this.#stats = new Int32Array(buffers.stats)
    if (this.#stats.length < SPEAKER_STATS_WORDS) throw new RangeError('shared speaker stats are too small')
    this.#postMessage = postMessage
  }

  readonly createOutput: UsbAudioSpeakerOutputFactory = (options) => {
    this.#current?.close()
    const output = new SharedSpeakerOutput(this.#ring, this.#stats, this.#postMessage, options)
    this.#current = output
    return output
  }

  get writtenBytes(): number {
    return this.#current?.writtenBytes ?? 0
  }

  get streamId(): number {
    return this.#current?.streamId ?? 0
  }

  handleDrained(streamId: number): void {
    if (this.#current?.streamId !== streamId) return
    this.#current.handleDrained()
  }

  handleOpened(streamId: number): void {
    if (this.#current?.streamId !== streamId) return
    this.#current.handleOpened()
  }

  handleFailed(streamId: number): void {
    if (this.#current?.streamId !== streamId) return
    this.#current.handleFailed()
  }

  close(): void {
    this.#current?.close()
    this.#current = undefined
  }
}

export function resetSharedSpeakerOutputState(ring: SharedByteRing, stats: Int32Array): void {
  Atomics.store(ring.state, 0, 0)
  Atomics.store(ring.state, 1, 0)
  for (let index = 0; index < stats.length; index += 1) Atomics.store(stats, index, 0)
}
