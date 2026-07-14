import MP3Streamer from 'buffered-mp3streamer-core'
import resamplePCM16Mono from 'pcm-resampler'
import Timer from 'timer'
import { SharedByteRing } from 'web-radio-byte-ring'

const FRAMES_PER_OUTPUT_BATCH = 4
const MAX_SAMPLES_PER_FRAME = 1152
const MAX_COMPLETION_CALLBACKS_PER_PUMP = 8

function completedThrough(completed, end) {
  return (completed - end) >>> 0 < 0x80000000
}

class WorkerAudioSink {
  static Samples = 1
  static Flush = 2
  static Callback = 3
  static Volume = 4
  static RawSamples = 5
  static Tone = 6
  static Silence = 7

  callbacks = []
  #completed = []
  #inflight = []
  #waiting = []
  #completion
  #output
  #pending
  #queueLength
  #sourceSampleRate
  #targetSampleRate
  #resamplerState = new Int32Array(new ArrayBuffer(3 * Int32Array.BYTES_PER_ELEMENT))
  #sourceBatch = new ArrayBuffer(FRAMES_PER_OUTPUT_BATCH * MAX_SAMPLES_PER_FRAME * 2)
  #outputBatch = new ArrayBuffer(FRAMES_PER_OUTPUT_BATCH * MAX_SAMPLES_PER_FRAME * 2)
  #producedBytes = 0

  constructor(queueLength, completion, output, sourceSampleRate, targetSampleRate) {
    this.#queueLength = queueLength
    this.#completion = completion
    this.#output = new SharedByteRing(output.data, output.state)
    this.#sourceSampleRate = sourceSampleRate
    this.#targetSampleRate = targetSampleRate
  }

  enqueue(_stream, kind, value, _repeat, offset, count) {
    if (kind === WorkerAudioSink.Flush) return this
    if (kind === WorkerAudioSink.RawSamples) {
      this.#pending = {
        buffer: value,
        offset: offset ?? 0,
        count: count ?? Math.idiv(value.byteLength, 2),
      }
      return this
    }
    if (kind !== WorkerAudioSink.Callback || !this.#pending) throw new Error('Invalid worker audio command')

    this.#waiting.push({ samples: Number(value), ...this.#pending })
    this.#pending = undefined
    this.#flushWaiting()
    return this
  }

  length(stream) {
    if (stream !== 0) return 0
    let inflightFrames = 0
    for (const item of this.#inflight) inflightFrames += item.callbacks.length
    return this.#queueLength - inflightFrames - this.#waiting.length
  }

  drainCompleted() {
    const completed = Atomics.load(this.#completion, 0) >>> 0
    while (this.#inflight.length && completedThrough(completed, this.#inflight[0].end)) {
      const item = this.#inflight.shift()
      for (const samples of item.callbacks) this.#completed.push(samples)
    }

    let callbacks = MAX_COMPLETION_CALLBACKS_PER_PUMP
    while (callbacks-- && this.#completed.length) {
      this.callbacks[0]?.(this.#completed.shift())
    }
    this.#flushWaiting(false)
  }

  flushPending() {
    this.#flushWaiting(true)
  }

  #flushWaiting(force = false) {
    while (this.#waiting.length && (force || this.#waiting.length >= FRAMES_PER_OUTPUT_BATCH)) {
      const frameCount = Math.min(FRAMES_PER_OUTPUT_BATCH, this.#waiting.length)
      let sourceCount = 0
      for (let index = 0; index < frameCount; index += 1) sourceCount += this.#waiting[index].count
      const maximumOutputCount =
        Math.floor((sourceCount * this.#targetSampleRate + this.#sourceSampleRate - 1) / this.#sourceSampleRate) + 1
      if (this.#output.writableBytes < maximumOutputCount * 2) break

      const sourceBuffer = this.#sourceBatch
      const target = new Uint8Array(sourceBuffer)
      const callbacks = []
      let count = 0
      let frames = FRAMES_PER_OUTPUT_BATCH
      while (frames-- && this.#waiting.length) {
        const item = this.#waiting.shift()
        target.set(new Uint8Array(item.buffer, item.offset * 2, item.count * 2), count * 2)
        count += item.count
        callbacks.push(item.samples)
      }
      const outputCount = resamplePCM16Mono(
        sourceBuffer,
        0,
        count,
        this.#outputBatch,
        this.#sourceSampleRate,
        this.#targetSampleRate,
        this.#resamplerState,
      )
      const outputBytes = outputCount * 2
      const source = new Uint8Array(this.#outputBatch, 0, outputBytes)
      const wasEmpty = this.#output.readableBytes === 0
      let position = 0
      while (position < outputBytes) {
        const destination = this.#output.writableView(outputBytes - position)
        destination.set(source.subarray(position, position + destination.byteLength))
        this.#output.advanceWrite(destination.byteLength)
        position += destination.byteLength
      }
      this.#producedBytes = (this.#producedBytes + outputBytes) >>> 0
      this.#inflight.push({ end: this.#producedBytes, callbacks })
      if (wasEmpty) self.postMessage({ id: 'output' })
    }
  }
}

let audio
let completionTimer
let streamer

function pump() {
  try {
    audio?.drainCompleted()
    streamer?.pump()
    audio?.flushPending()
  } catch (error) {
    if (completionTimer !== undefined) Timer.clear(completionTimer)
    completionTimer = undefined
    self.postMessage({ id: 'error', reason: String(error) })
  }
}

self.onmessage = (message) => {
  switch (message.id) {
    case 'start': {
      audio = new WorkerAudioSink(
        message.queueLength,
        message.completion,
        message.output,
        message.sampleRate,
        message.outputSampleRate,
      )
      completionTimer = Timer.repeat(pump, 25)
      streamer = new MP3Streamer({
        input: message.input,
        audio: { out: audio, stream: 0, sampleRate: message.sampleRate },
        onReady: (value) => self.postMessage({ id: 'ready', value }),
        onError: (reason) => self.postMessage({ id: 'error', reason: String(reason) }),
        onDone: () => self.postMessage({ id: 'done' }),
      })
      break
    }
    case 'end':
      streamer?.end(message.reason)
      break
    case 'close':
      if (completionTimer !== undefined) Timer.clear(completionTimer)
      completionTimer = undefined
      streamer?.close()
      streamer = audio = undefined
      break
  }
}
