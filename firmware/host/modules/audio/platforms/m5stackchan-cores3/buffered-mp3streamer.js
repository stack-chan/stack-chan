/*
 * CoreS3 MP3 decoder running on a Worker. Compressed bytes are supplied by a
 * SharedArrayBuffer ring so HTTP reception can continue independently on the
 * main XS machine while this Worker spends most of Core 1 decoding.
 */

import MP3 from 'esp32-mp3-decoder'
import { SharedByteRing } from 'web-radio-byte-ring'

const MP3_MAX_SAMPLES_PER_FRAME = 1152
const TARGET_BUFFER_FRAMES = 32
const READ_BUFFER_BYTES = 65536
const READ_REFILL_THRESHOLD_BYTES = 16 * 1024
const START_BUFFER_BYTES = 160 * 1024
const RECOVERY_BUFFER_BYTES = 64 * 1024

function createSharedByteBuffer(byteLength) {
  return new Uint8Array(new SharedArrayBuffer(byteLength))
}

export default class {
  #audio
  #stream
  #input
  #playing = []
  #free = []
  #ready
  #samplesQueued = 0
  #targetSamplesQueued = MP3_MAX_SAMPLES_PER_FRAME * TARGET_BUFFER_FRAMES
  #callbacks = {}
  #pending = []
  #readBuffer = createSharedByteBuffer(READ_BUFFER_BYTES)
  #readOffset = 0
  #readLength = 0
  #info = {}
  #mp3 = new MP3()
  #needsPrebuffer = true
  #prebufferBytes = START_BUFFER_BYTES
  #doneError

  constructor(options) {
    if (options.onPlayed) this.#callbacks.onPlayed = options.onPlayed
    if (options.onReady) this.#callbacks.onReady = options.onReady
    if (options.onError) this.#callbacks.onError = options.onError
    if (options.onDone) this.#callbacks.onDone = options.onDone

    this.#input = new SharedByteRing(options.input.data, options.input.state)
    const audio = options.audio.out
    this.#audio = audio
    this.#stream = options.audio.stream ?? 0
    audio.callbacks ??= []
    audio.callbacks[this.#stream] = (samples) => {
      if (!samples) {
        this.#callbacks.onDone?.call(this)
        return
      }

      this.#samplesQueued -= samples
      const played = this.#playing.shift()
      this.#free.push(played)
      this.#callbacks.onPlayed?.call(this, played)
      this.#fillQueue()

      if (this.#samplesQueued !== 0) return
      this.#ready = false
      this.#pending = []
      this.#needsPrebuffer = true
      this.#prebufferBytes = RECOVERY_BUFFER_BYTES
      if (this.#info.done) {
        this.#notifyDone()
      } else {
        trace(`[web-radio-stream] underrun compressed=${this.#compressedBytes}\n`)
        this.#callbacks.onReady?.call(this, false)
      }
    }
  }

  close() {
    if (this.#audio) {
      this.#audio.enqueue(this.#stream, this.#audio.constructor.Flush)
      this.#audio.callbacks[this.#stream] = null
    }
    this.#mp3?.close()
    this.#input = this.#audio = this.#playing = this.#pending = this.#free = this.#mp3 = undefined
  }

  end(error) {
    if (this.#info.done) return
    this.#info.done = 1
    this.#doneError = error
    trace(`[web-radio-stream] input done error=${error ?? 'none'} compressed=${this.#compressedBytes}\n`)
    this.#fillQueue()
    if (!this.#samplesQueued) this.#notifyDone()
  }

  pump() {
    this.#fillQueue()
  }

  get #compressedBytes() {
    return this.#readLength + (this.#input?.readableBytes ?? 0)
  }

  #notifyDone() {
    if (this.#info.done !== 1) return
    this.#info.done = 2
    const error = this.#doneError
    this.#doneError = undefined
    if (error) this.#callbacks.onError?.call(this, error)
    else this.#callbacks.onDone?.call(this)
  }

  #fillReadBuffer() {
    const readBuffer = this.#readBuffer
    if (this.#readLength >= READ_REFILL_THRESHOLD_BYTES) return

    if (this.#readOffset) {
      readBuffer.copyWithin(0, this.#readOffset, this.#readOffset + this.#readLength)
      this.#readOffset = 0
    }

    let available = readBuffer.length - this.#readLength
    while (available && this.#input.readableBytes) {
      const source = this.#input.readableView(available)
      if (!source.byteLength) break
      readBuffer.set(source, this.#readLength)
      this.#readLength += source.byteLength
      available -= source.byteLength
      this.#input.advanceRead(source.byteLength)
    }
  }

  #consumeReadBuffer(byteLength) {
    this.#readOffset += byteLength
    this.#readLength -= byteLength
    if (!this.#readLength) this.#readOffset = 0
  }

  #fillQueue() {
    const readBuffer = this.#readBuffer
    if (!readBuffer) return
    for (;;) {
      this.#fillReadBuffer()

      if (!this.#readLength) break
      if (this.#needsPrebuffer && this.#compressedBytes < this.#prebufferBytes && !this.#info.done) break
      this.#needsPrebuffer = false
      if (this.#samplesQueued >= this.#targetSamplesQueued) break
      if (this.#audio.length(this.#stream) < 2) break

      const readEnd = this.#readOffset + this.#readLength
      const found = MP3.scan(readBuffer, this.#readOffset, readEnd, this.#info)
      if (!found || found.position + found.length + MP3.BUFFER_GUARD > readEnd) {
        if (found) {
          this.#consumeReadBuffer(found.position - this.#readOffset)
        } else {
          const use = this.#readLength < 4 ? this.#readLength : 4
          this.#consumeReadBuffer(this.#readLength - use)
        }
        if (this.#input.readableBytes) continue
        break
      }

      if (this.#ready === undefined) this.#ready = false
      const slice = this.#free.shift() ?? new SharedArrayBuffer(MP3_MAX_SAMPLES_PER_FRAME * 2)
      const byteLength = this.#mp3.decode(
        readBuffer.subarray(found.position, found.position + found.length + MP3.BUFFER_GUARD),
        slice,
      )
      if (byteLength && slice.samples) {
        if (this.#pending) this.#pending.push(slice)
        else this.#enqueueDecoded(slice)
        this.#samplesQueued += slice.samples
      }

      const consumed = found.position - this.#readOffset + (byteLength || found.length)
      this.#consumeReadBuffer(consumed)
    }

    if (this.#ready || this.#samplesQueued < this.#targetSamplesQueued) return
    this.#ready = true
    while (this.#pending.length) this.#enqueueDecoded(this.#pending.shift())
    this.#pending = undefined
    this.#callbacks.onReady?.call(this, true)
  }

  #enqueueDecoded(slice) {
    this.#audio.enqueue(this.#stream, this.#audio.constructor.RawSamples, slice, 1, 0, slice.samples)
    this.#audio.enqueue(this.#stream, this.#audio.constructor.Callback, slice.samples)
    this.#playing.push(slice)
  }
}
