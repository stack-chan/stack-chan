import type { AudioSink, PlaybackLease } from 'stackchan/voice/contracts'
import { writeSink } from 'stackchan/voice/media'
import Timer from 'timer'

type SharedOutputRing = {
  readableView(maximum?: number): Uint8Array
  advanceRead(count: number): void
}
type RingSink = AudioSink & {
  writeBorrowed?(bytes: Uint8Array, accepted: (size: number) => void): void | Promise<void>
}

export default class WebRadioAudioOut {
  readonly sampleRate = 24000
  #lease: PlaybackLease
  #sink?: RingSink
  #output?: SharedOutputRing
  #completion?: Int32Array
  #onWritten?: () => void
  #onError: (error: unknown) => void
  #pumping = false
  #closed = false

  constructor(lease: PlaybackLease, onError: (error: unknown) => void) {
    this.#lease = lease
    this.#onError = onError
  }

  attachSharedOutput(output: SharedOutputRing, completion: Int32Array, onWritten: () => void) {
    this.#output = output
    this.#completion = completion
    this.#onWritten = onWritten
    Atomics.store(completion, 0, 0)
    this.pumpSharedOutput()
  }

  detachSharedOutput(output: SharedOutputRing) {
    if (this.#output !== output) return
    this.#output = this.#completion = this.#onWritten = undefined
  }

  pumpSharedOutput() {
    if (!this.#sink || !this.#output || this.#pumping || this.#closed) return
    this.#pumping = true
    void this.#pump(this.#sink, this.#output)
  }

  async #pump(sink: RingSink, output: SharedOutputRing) {
    const accepted = (count: number) => {
      if (this.#closed || this.#output !== output || !this.#completion) return
      output.advanceRead(count)
      Atomics.add(this.#completion, 0, count)
      this.#onWritten?.()
    }
    try {
      while (!this.#closed && this.#output === output) {
        // The CoreS3 sink releases each accepted prefix while the rest of the ring remains borrowed.
        const bytes = output.readableView(sink.writeBorrowed ? undefined : 2048)
        if (!bytes.length) break
        if (sink.writeBorrowed) {
          const pending = sink.writeBorrowed(bytes, accepted)
          if (pending) await pending
        } else {
          await writeSink(sink, bytes)
          accepted(bytes.byteLength)
        }
      }
    } catch (error) {
      if (!this.#closed && this.#output === output) this.#onError(error)
    } finally {
      this.#pumping = false
    }
  }

  get playedSeconds(): number {
    const cursor = this.#lease.output.position?.('media')
    return cursor && cursor.basis !== 'unknown' ? cursor.renderedFrames / cursor.sampleRate : 0
  }

  setVolume(volume: number) {
    this.#lease.setVolume(volume)
  }

  start() {
    if (this.#closed || this.#sink) return
    this.#sink = this.#lease.output.begin('media', 0)
    this.pumpSharedOutput()
  }

  async drain() {
    if (!this.#sink) return
    let timer: ReturnType<typeof Timer.set> | undefined
    try {
      const receipt = await Promise.race([
        this.#lease.output.finish('media'),
        new Promise<never>((_, reject) => {
          timer = Timer.set(() => reject(new Error('Audio drain timed out')), 5000)
        }),
      ])
      if (receipt.state !== 'played') throw new Error(`Media playback ${receipt.state}`)
    } finally {
      if (timer !== undefined) Timer.clear(timer)
    }
  }

  close() {
    this.#closed = true
    this.#output = this.#completion = this.#onWritten = undefined
    return this.#lease.close()
  }
}
