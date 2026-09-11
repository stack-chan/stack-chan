import { type OwnedAudioBuffer, ownAudioBuffer } from 'audio-buffer'
import AudioIn from 'audio-in'
import type { AudioInputPort } from 'audio-ports'
import {
  createRecordingWave,
  DEFAULT_RECORDING_DURATION_MS,
  RECORDING_GRACE_MS,
  validateRecordingDuration,
} from 'recording-wave'
import { asStackchanError, StackchanError } from 'stackchan/errors'
import type { OperationOptions } from 'stackchan/task'
import Timer from 'timer'

type RecordingClock = { after(durationMs: number, callback: () => void): () => void }
type CleanupResult = StackchanError | undefined | Promise<StackchanError | undefined>
const clock: RecordingClock = {
  after(durationMs, callback) {
    const timer = Timer.set(callback, durationMs)
    return () => Timer.clear(timer)
  },
}

export default class Microphone implements AudioInputPort {
  readonly #clock: RecordingClock
  #audioIn: AudioIn | undefined
  #recording = false
  #releasing = false
  #releasePromise: Promise<void> | undefined
  #inReadable = 0
  #epoch = 0
  #closed = false
  #failure: StackchanError | undefined
  #abortRecording: ((reason: StackchanError) => CleanupResult) | undefined
  onReadable?: (this: AudioIn, byteLength: number, sampleCount?: number) => void

  constructor(options: { clock?: RecordingClock } = {}) {
    this.#clock = options.clock ?? clock
  }

  get recording(): boolean {
    return this.#recording
  }

  get available(): boolean {
    return !this.#closed && !this.#failure
  }

  get releaseFailure(): StackchanError | undefined {
    return this.#failure
  }

  #assertAvailable(): void {
    if (this.#closed) throw new StackchanError('CLOSED', 'Microphone is closed')
    if (this.#failure) throw this.#failure
    if (this.#recording || this.#releasing) throw new StackchanError('BUSY', 'Microphone is already recording')
  }

  #releaseInput(epoch = this.#epoch): void | Promise<void> {
    if (epoch !== this.#epoch) return
    if (this.#releasing) return this.#releasePromise
    const input = this.#audioIn
    this.#audioIn = undefined
    this.#releasing = true
    const close = () => {
      try {
        input?.close()
      } catch (error) {
        this.#failure = asStackchanError(error)
        throw this.#failure
      } finally {
        this.#recording = false
        this.#releasing = false
        this.#releasePromise = undefined
      }
    }
    // SDK 9.5 AudioIn keeps pendingCallback set while delivering onReadable.
    // Close after returning to C so the input record is freed, not left pending.
    if (this.#inReadable) {
      this.#releasePromise = Promise.resolve().then(close)
      return this.#releasePromise
    }
    close()
  }

  /** Attempt all releases. A failed physical close prevents this microphone from reopening. */
  #cleanup(actions: Array<(() => void | Promise<void>) | undefined>): CleanupResult {
    const errors: unknown[] = []
    const pending: Promise<void>[] = []
    for (const action of actions) {
      try {
        const result = action?.()
        if (result)
          pending.push(
            result.catch((error) => {
              errors.push(error)
            }),
          )
      } catch (error) {
        errors.push(error)
      }
    }
    const finish = () => {
      if (errors.length) {
        this.#failure = asStackchanError(
          errors.length === 1 ? errors[0] : new AggregateError(errors, 'Microphone cleanup failed'),
        )
        return this.#failure
      }
    }
    return pending.length ? Promise.all(pending).then(finish) : finish()
  }

  monitor(onLevel: (level: number) => void): void {
    this.#assertAvailable()
    this.onReadable = function (size) {
      const buffer = this.read(size)
      if (!buffer || buffer.byteLength % 2)
        throw new StackchanError('IO', 'Microphone returned an incomplete PCM frame')
      const samples = new Int16Array(buffer)
      let power = 0
      for (const sample of samples) power += sample * sample
      onLevel(samples.length ? Math.min(1, Math.sqrt(power / samples.length) / 32768) : 0)
    }
    this.start()
  }

  start(): void {
    this.#assertAvailable()
    this.#recording = true
    const epoch = ++this.#epoch
    const owner = this
    let input: AudioIn | undefined
    try {
      input = new AudioIn({
        channels: 1,
        onReadable(size, sampleCount) {
          if (!input || owner.#audioIn !== input || !owner.#recording) return
          owner.#inReadable++
          try {
            owner.onReadable?.call(this, size, sampleCount)
          } catch (error) {
            const cleanupError = owner.#cleanup([() => owner.#releaseInput(epoch)])
            throw cleanupError instanceof Promise ? asStackchanError(error) : (cleanupError ?? asStackchanError(error))
          } finally {
            owner.#inReadable--
          }
        },
      })
      this.#audioIn = input
      input.start()
    } catch (error) {
      const cleanupError = this.#cleanup([() => this.#releaseInput(epoch)])
      throw cleanupError instanceof Promise ? asStackchanError(error) : (cleanupError ?? asStackchanError(error))
    }
  }

  stop(reason = new StackchanError('CANCELLED', 'Recording cancelled')): void | Promise<void> {
    const error = this.#abortRecording ? this.#abortRecording(reason) : this.#cleanup([() => this.#releaseInput()])
    const finish = (failure: StackchanError | undefined) => {
      if (failure) throw failure
      if (this.#failure) throw this.#failure
    }
    if (error instanceof Promise) return error.then(finish)
    finish(error)
  }

  close(): void | Promise<void> {
    this.#closed = true
    this.onReadable = undefined
    return this.stop(new StackchanError('CLOSED', 'Microphone is closed'))
  }

  async record(durationMs = DEFAULT_RECORDING_DURATION_MS, options: OperationOptions = {}): Promise<OwnedAudioBuffer> {
    this.#assertAvailable()
    validateRecordingDuration(durationMs)
    options.signal?.throwIfCancelled()
    this.#recording = true
    const epoch = ++this.#epoch
    return new Promise<OwnedAudioBuffer>((resolve, reject) => {
      let finished = false
      let clearDeadline: (() => void) | undefined
      let unsubscribe: (() => void) | undefined
      let input: AudioIn | undefined
      let wave: ReturnType<typeof createRecordingWave>
      let offset = 0
      const finish = (error?: unknown): CleanupResult => {
        if (finished) return
        finished = true
        this.#abortRecording = undefined
        const cleanupError = this.#cleanup([clearDeadline, unsubscribe, () => this.#releaseInput(epoch)])
        clearDeadline = undefined
        unsubscribe = undefined
        const settle = (failure: StackchanError | undefined) => {
          if (failure) reject(failure)
          else if (error !== undefined) reject(asStackchanError(error))
          else resolve(ownAudioBuffer(wave.buffer))
          return failure
        }
        if (cleanupError instanceof Promise) return cleanupError.then(settle)
        settle(cleanupError)
        return cleanupError
      }
      this.#abortRecording = finish
      const owner = this
      try {
        input = new AudioIn({
          channels: 1,
          onReadable(size) {
            if (finished || !input || owner.#audioIn !== input) return
            owner.#inReadable++
            try {
              if (!Number.isInteger(size) || size < wave.bytesPerFrame)
                throw new StackchanError('IO', 'Microphone reported an incomplete PCM frame')
              const requested = Math.min(size - (size % wave.bytesPerFrame), wave.samples.byteLength - offset)
              const chunk = this.read(requested)
              if (
                !chunk ||
                chunk.byteLength === 0 ||
                chunk.byteLength > requested ||
                chunk.byteLength % wave.bytesPerFrame
              )
                throw new StackchanError('IO', 'Microphone did not return complete PCM frames')
              wave.samples.set(new Uint8Array(chunk), offset)
              offset += chunk.byteLength
              if (offset === wave.samples.byteLength) finish()
            } catch (error) {
              finish(error)
            } finally {
              owner.#inReadable--
            }
          },
        })
        this.#audioIn = input
        wave = createRecordingWave(input, durationMs)
        unsubscribe = options.signal?.subscribe((reason) => {
          finish(reason)
        })
        if (finished) {
          this.#cleanup([unsubscribe])
          return
        }
        clearDeadline = this.#clock.after(Math.ceil(durationMs) + RECORDING_GRACE_MS, () => {
          finish(
            new StackchanError('TIMEOUT', 'Microphone did not deliver the requested recording before its deadline'),
          )
        })
        if (finished) {
          this.#cleanup([clearDeadline])
          return
        }
        input.start()
      } catch (error) {
        finish(error)
      }
    })
  }
}
