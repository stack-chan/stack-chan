/*
 * CoreS3 MP3 decoder running on a Worker. Compressed bytes are supplied by a
 * SharedArrayBuffer ring so HTTP reception can continue independently on the
 * main XS machine while this Worker spends most of Core 1 decoding.
 */

import MP3 from 'esp32-mp3-decoder'
import { id3Size, mp3Duration } from 'mp3-metadata'
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
  #atStart = true
  #skip = 0
  #decoded = 0
  #sourceRate
  #finite = false
  #bytePosition = 0
  #seconds = 0
  #seekSeconds = 0
  #firstFrame = true
  #framesSeen = 0
  #totalBytes
  #duration
  #estimated = false
  #bitRate
  #lastCheckpoint = -Infinity
  #outputStarted = false
  #sourceReady = false

  constructor(options) {
    if (options.onPlayed) this.#callbacks.onPlayed = options.onPlayed
    if (options.onReady) this.#callbacks.onReady = options.onReady
    if (options.onError) this.#callbacks.onError = options.onError
    if (options.onDone) this.#callbacks.onDone = options.onDone

    this.#finite = options.mode === 'finite'
    this.#sourceReady = !this.#finite
    this.#seekSeconds = options.seekSeconds ?? 0
    this.#callbacks.onMetadata = options.onMetadata
    this.#callbacks.onCheckpoint = options.onCheckpoint
    this.#callbacks.onOutputStart = options.onOutputStart
    this.#input = new SharedByteRing(options.input.data, options.input.state)
    const audio = options.audio.out
    this.#audio = audio
    this.#stream = options.audio.stream ?? 0
    audio.callbacks ??= []
    audio.callbacks[this.#stream] = (samples) => {
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
    this.#input = this.#audio = this.#playing = this.#pending = this.#free = this.#readBuffer = this.#mp3 = undefined
  }

  source({ offset = 0, seconds = 0, totalBytes }) {
    this.#sourceReady = true
    this.#bytePosition = offset
    this.#seconds = seconds
    this.#totalBytes = totalBytes
    this.#atStart = offset === 0
  }

  end(error) {
    if (this.#info.done) return
    this.#info.done = 1
    this.#doneError = error
    trace(`[web-radio-stream] input done error=${error ?? 'none'} compressed=${this.#compressedBytes}\n`)
    // The worker pump handles decode errors and all remaining output.
  }

  pump() {
    this.#fillQueue()
  }

  get #compressedBytes() {
    return this.#readLength + (this.#input?.readableBytes ?? 0)
  }

  #notifyDone() {
    if (this.#info.done !== 1 || this.#compressedBytes || this.#samplesQueued) return
    if (this.#skip) throw new Error('Truncated ID3 tag')
    if (!this.#decoded && !(this.#seekSeconds > 0 && this.#framesSeen) && !this.#doneError)
      this.#doneError = 'No supported MP3 audio'
    this.#info.done = 2
    if (this.#finite && !this.#doneError) this.#callbacks.onMetadata?.({ duration: this.#seconds, estimated: false })
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
    this.#bytePosition += byteLength
    this.#readOffset += byteLength
    this.#readLength -= byteLength
    if (!this.#readLength) this.#readOffset = 0
  }

  #fillQueue() {
    const readBuffer = this.#readBuffer
    if (!readBuffer || !this.#sourceReady) return
    let budget = 64
    for (;;) {
      this.#fillReadBuffer()

      if (!this.#readLength) break
      if (this.#skip) {
        const use = Math.min(this.#skip, this.#readLength)
        this.#consumeReadBuffer(use)
        this.#skip -= use
        continue
      }
      if (this.#atStart) {
        if (this.#readLength < 10 && !this.#info.done) break
        const size = id3Size(readBuffer.subarray(this.#readOffset, this.#readOffset + this.#readLength))
        if (size === undefined) throw new Error('Truncated ID3 header')
        if (size) {
          this.#skip = size
          continue
        }
        this.#atStart = false
      }
      if (
        this.#needsPrebuffer &&
        this.#seconds >= this.#seekSeconds &&
        this.#compressedBytes < this.#prebufferBytes &&
        !this.#info.done
      )
        break
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
        if (this.#info.done) {
          if (found || readBuffer[this.#readOffset] === 0xff) throw new Error('Truncated MP3 frame')
          this.#consumeReadBuffer(this.#readLength)
        }
        break
      }

      if (found.sampleRate !== 44100 && found.sampleRate !== 48000) throw new Error('MP3 requires 44100 or 48000 Hz')
      if (this.#sourceRate && this.#sourceRate !== found.sampleRate) throw new Error('MP3 sample rate changed')
      this.#sourceRate = found.sampleRate
      if (!budget--) break
      const frameBytes = readBuffer.subarray(found.position, found.position + found.length)
      const offset = this.#bytePosition + found.position - this.#readOffset
      const seconds = this.#seconds
      if (this.#finite) {
        if (this.#firstFrame) {
          this.#bitRate = found.bitRate
          this.#estimated = seconds !== 0
          if (seconds === 0) {
            this.#duration = mp3Duration(frameBytes, found)
            this.#estimated = !this.#duration
            if (!this.#duration && this.#totalBytes > offset && found.bitRate)
              this.#duration = ((this.#totalBytes - offset) * 8) / found.bitRate
            this.#callbacks.onMetadata?.({ duration: this.#duration, estimated: this.#estimated })
          }
        } else if (this.#estimated && found.bitRate !== this.#bitRate) {
          this.#duration = undefined
          this.#estimated = false
          this.#callbacks.onMetadata?.({ duration: undefined, estimated: false })
        }
        if (seconds - this.#lastCheckpoint >= 5 || this.#firstFrame) {
          this.#lastCheckpoint = seconds
          this.#callbacks.onCheckpoint?.({ offset, seconds })
        }
      }
      this.#firstFrame = false
      this.#framesSeen++
      this.#seconds += found.samples / found.sampleRate
      // Walk frame headers rapidly until one second before the target, then
      // decode preroll to reconstruct Layer III's bit reservoir.
      if (this.#seconds < this.#seekSeconds - 1) {
        this.#consumeReadBuffer(found.position - this.#readOffset + found.length)
        continue
      }
      if (this.#ready === undefined) this.#ready = false
      const slice = this.#free.shift() ?? new SharedArrayBuffer(MP3_MAX_SAMPLES_PER_FRAME * 2)
      const byteLength = this.#mp3.decode(
        readBuffer.subarray(found.position, found.position + found.length + MP3.BUFFER_GUARD),
        slice,
      )
      if (byteLength && slice.samples) {
        if (slice.sampleRate !== this.#sourceRate) throw new Error('MP3 decoder sample rate mismatch')
        this.#decoded += 1
        const skipSamples = Math.min(
          slice.samples,
          Math.max(0, Math.ceil((this.#seekSeconds - seconds) * found.sampleRate - 1e-6)),
        )
        if (skipSamples) {
          new Int16Array(slice).copyWithin(0, skipSamples, slice.samples)
          slice.samples -= skipSamples
        }
        if (slice.samples && !this.#outputStarted) {
          this.#outputStarted = true
          this.#callbacks.onOutputStart?.(seconds + skipSamples / found.sampleRate)
        }
        if (!slice.samples) this.#free.push(slice)
        else if (this.#pending) this.#pending.push(slice)
        else this.#enqueueDecoded(slice)
        this.#samplesQueued += slice.samples
      } else this.#free.push(slice)

      const consumed = found.position - this.#readOffset + (byteLength || found.length)
      this.#consumeReadBuffer(consumed)
    }

    this.#notifyDone()
    if (this.#ready || !this.#samplesQueued || (this.#samplesQueued < this.#targetSamplesQueued && !this.#info.done))
      return
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
