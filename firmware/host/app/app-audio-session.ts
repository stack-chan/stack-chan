import { CancellationSource } from 'cancellation'
import type { AppAudio, PlaybackOptions } from 'stackchan/app'
import type { AudioData, RecordedAudio, RecordingOptions } from 'stackchan/audio'
import { asStackchanError, StackchanError } from 'stackchan/errors'
import type { AppSinging, SongNote } from 'stackchan/extensions/audio'
import type { CancellationSignal } from 'stackchan/task'

export type AppAudioPort = AppAudio & Partial<AppSinging> & { readonly releaseFailure: StackchanError | undefined }
type PendingAudio = { source: CancellationSource; done: Promise<void> }

/** Owns an app's audio commands; the host retains providers and the device queue. */
export class AppAudioSession implements AppAudio {
  readonly #port: AppAudioPort
  readonly #pending = new Set<PendingAudio>()
  #closing: Promise<void> | undefined
  #failure: StackchanError | undefined

  constructor(port: AppAudioPort) {
    this.#port = port
  }

  get pendingCount(): number {
    return this.#pending.size
  }

  say(text: string, options: PlaybackOptions = {}): Promise<void> {
    const request = { ...options }
    return this.#run((signal) => this.#port.say(text, { ...request, signal }), request.signal)
  }

  sing(bpm: number, score: readonly SongNote[], options: PlaybackOptions = {}): Promise<void> {
    const request = { ...options }
    return this.#run((signal) => {
      if (!this.#port.sing) throw new StackchanError('UNSUPPORTED', 'Singing is unavailable')
      return this.#port.sing(bpm, score, { ...request, signal })
    }, request.signal)
  }

  playClip(name: string, options: PlaybackOptions = {}): Promise<void> {
    const request = { ...options }
    return this.#run((signal) => this.#port.playClip(name, { ...request, signal }), request.signal)
  }

  tone(hz: number, options: PlaybackOptions & { durationMs: number }): Promise<void> {
    const request = { ...options }
    return this.#run((signal) => this.#port.tone(hz, { ...request, signal }), request.signal)
  }

  record(options: RecordingOptions = {}): Promise<RecordedAudio> {
    const request = { ...options }
    return this.#run((signal) => this.#port.record({ ...request, signal }), request.signal)
  }

  play(audio: AudioData, options: PlaybackOptions = {}): Promise<void> {
    const request = { ...options }
    const data = { ...audio }
    return this.#run((signal) => this.#port.play(data, { ...request, signal }), request.signal)
  }

  close(): Promise<void> {
    if (!this.#closing) {
      // Publish before cancellation handlers can reenter the app or its host.
      this.#closing = Promise.resolve().then(async () => {
        const pending = [...this.#pending]
        for (const operation of pending) {
          try {
            operation.source.cancel(new StackchanError('CLOSED', 'App audio is closed'))
          } catch (error) {
            this.#failure ??= asStackchanError(error)
          }
        }
        await Promise.all(pending.map((operation) => operation.done))
        const failure = this.#failure ?? this.#port.releaseFailure
        if (failure) throw failure
      })
    }
    return this.#closing
  }

  #run<T>(start: (signal: CancellationSignal) => Promise<T>, parent?: CancellationSignal): Promise<T> {
    if (this.#closing) return Promise.reject(new StackchanError('CLOSED', 'App audio is closed'))
    const source = new CancellationSource()
    // RuntimeAudio bounds the queue and physical stop. Retain its actual result,
    // even when TaskScope has already delivered cancellation to app code.
    const work = Promise.resolve().then(async () => {
      let unsubscribe: (() => void) | undefined
      try {
        if (this.#closing) throw new StackchanError('CLOSED', 'App audio is closed')
        const failure = this.#failure ?? this.#port.releaseFailure
        if (failure) throw failure
        unsubscribe = parent?.subscribe((reason) => source.cancel(reason))
        source.signal.throwIfCancelled()
        if (this.#closing) throw new StackchanError('CLOSED', 'App audio is closed')
        return await start(source.signal)
      } finally {
        try {
          unsubscribe?.()
        } catch (error) {
          this.#failure ??= asStackchanError(error)
        }
        try {
          source.cancel()
        } catch (error) {
          this.#failure ??= asStackchanError(error)
        }
        this.#pending.delete(operation)
      }
    })
    const result = work.then(
      (value) => {
        if (this.#failure) throw this.#failure
        return value
      },
      (error) => {
        throw this.#failure ?? asStackchanError(error)
      },
    )
    const operation = {
      source,
      done: result.then(
        () => {},
        () => {},
      ),
    }
    this.#pending.add(operation)
    return result
  }
}
