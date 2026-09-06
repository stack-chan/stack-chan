import { type OwnedAudioBuffer, ownAudioBuffer } from 'audio-buffer'
import { asStackchanError, finiteNumber, StackchanError } from 'stackchan/errors'
import type { OperationOptions } from 'stackchan/task'
import {
  DEFAULT_RECORDING_DURATION_MS,
  MAX_RECORDING_BYTES,
  MAX_RECORDING_DURATION_MS,
  RECORDING_GRACE_MS,
  RECORDING_PREPARE_TIMEOUT_MS,
  RECORDING_STOP_TIMEOUT_MS,
} from 'stackchan-contracts/audio-recording'
import {
  scheduleWasmAudioTimer,
  WASM_AUDIO_BRIDGE_POLL_INTERVAL_MS,
  type WasmAudioInputBridge,
} from 'wasm-audio-bridge-contract'

type PendingRecording = {
  stop(reason: StackchanError): void
  released: Promise<void>
}
type AudioBridgeGlobal = typeof globalThis & { __stackchanWasmAudioBridge?: WasmAudioInputBridge }

/** Own one handle, its polling, cancellation and confirmed browser release. */
export default class Microphone {
  readonly #bridge: WasmAudioInputBridge | undefined
  #pending: PendingRecording | undefined
  #closed = false
  #failure: StackchanError | undefined

  constructor(options: { bridge?: WasmAudioInputBridge } = {}) {
    this.#bridge = options.bridge ?? (globalThis as AudioBridgeGlobal).__stackchanWasmAudioBridge
  }

  get recording(): boolean {
    return !!this.#pending
  }
  get available(): boolean {
    return !this.#closed && !this.#failure && !!this.#bridge?.recordAvailable()
  }

  stop(reason = new StackchanError('CANCELLED', 'Recording cancelled')): void | Promise<void> {
    const pending = this.#pending
    if (pending) {
      pending.stop(reason)
      return pending.released
    }
    if (this.#failure) throw this.#failure
  }

  close(): void | Promise<void> {
    this.#closed = true
    return this.stop(new StackchanError('CLOSED', 'Microphone is closed'))
  }

  async record(durationMs = DEFAULT_RECORDING_DURATION_MS, options: OperationOptions = {}): Promise<OwnedAudioBuffer> {
    if (this.#closed) throw new StackchanError('CLOSED', 'Microphone is closed')
    if (this.#failure) throw this.#failure
    if (this.#pending) throw new StackchanError('BUSY', 'Microphone is already recording')
    finiteNumber(durationMs, 'durationMs', 1, MAX_RECORDING_DURATION_MS)
    options.signal?.throwIfCancelled()
    const bridge = this.#bridge
    if (!bridge?.recordAvailable())
      throw new StackchanError('UNSUPPORTED', 'Browser microphone recording is unavailable')
    let id: number
    try {
      id = bridge.startRecord(durationMs)
    } catch (error) {
      this.#failure = asStackchanError(error)
      throw this.#failure
    }
    if (!Number.isInteger(id) || id <= 0)
      throw new StackchanError('BUSY', 'Browser microphone has no recording handle available')

    return new Promise<OwnedAudioBuffer>((resolve, reject) => {
      let finished = false,
        stopping = false
      let reason: StackchanError | undefined
      let clearPoll: (() => void) | undefined
      let clearDeadline: (() => void) | undefined
      let unsubscribe: (() => void) | undefined
      let resolveReleased!: () => void
      let rejectReleased!: (error: StackchanError) => void
      const released = new Promise<void>((yes, no) => {
        resolveReleased = yes
        rejectReleased = no
      })
      // A caller may only await record(); close()/stop() still retain release errors.
      released.catch(() => {})
      const cleanup = (actions: Array<(() => void) | undefined>) => {
        for (const action of actions) {
          try {
            action?.()
          } catch (error) {
            this.#failure ??= asStackchanError(error)
          }
        }
      }
      const finish = (error?: StackchanError, buffer?: ArrayBuffer, releaseError?: StackchanError) => {
        if (finished) return
        finished = true
        this.#failure ??= releaseError
        cleanup([clearPoll, clearDeadline, unsubscribe, () => bridge.releaseRecord(id)])
        clearPoll = clearDeadline = unsubscribe = undefined
        if (this.#pending === pending) this.#pending = undefined
        const failure = this.#failure ?? error
        if (failure) reject(failure)
        else if (buffer) resolve(ownAudioBuffer(buffer))
        else reject(new StackchanError('IO', 'Microphone returned no recording'))
        if (this.#failure) rejectReleased(this.#failure)
        else resolveReleased()
      }
      const stop = (error: StackchanError) => {
        if (finished || stopping) return
        stopping = true
        reason = error
        cleanup([clearDeadline])
        clearDeadline = undefined
        try {
          bridge.stopRecord(id)
        } catch (caught) {
          this.#failure ??= asStackchanError(caught)
        }
        try {
          clearDeadline = scheduleWasmAudioTimer(
            bridge,
            () => {
              const failure = new StackchanError('TIMEOUT', 'Browser microphone release was not confirmed')
              finish(failure, undefined, failure)
            },
            RECORDING_STOP_TIMEOUT_MS + RECORDING_GRACE_MS,
          )
        } catch (caught) {
          this.#failure ??= asStackchanError(caught)
        }
        if (this.#failure) finish(this.#failure, undefined, this.#failure)
      }
      const pending: PendingRecording = { stop, released }
      this.#pending = pending
      const poll = () => {
        if (finished) return
        clearPoll = undefined
        let confirmedQuiet = false
        try {
          const status = bridge.recordStatus(id)
          if (status === 0 || status === 2) {
            clearPoll = scheduleWasmAudioTimer(bridge, poll, WASM_AUDIO_BRIDGE_POLL_INTERVAL_MS)
            return
          }
          const details = bridge.recordDetails(id)
          const error = details.error ? new StackchanError(details.error.code, details.error.message) : undefined
          if (!details.quiet) {
            const failure = error ?? new StackchanError('IO', 'Browser microphone is still using its input')
            finish(failure, undefined, failure)
            return
          }
          confirmedQuiet = true
          if (reason || error) {
            finish(reason ?? error)
            return
          }
          if (status !== 1) {
            finish(new StackchanError('IO', 'Browser recording failed'))
            return
          }
          const buffer = bridge.recordBuffer(id)
          if (!(buffer instanceof ArrayBuffer) || !buffer.byteLength || buffer.byteLength > MAX_RECORDING_BYTES)
            throw new StackchanError('IO', 'Browser microphone returned an invalid recording buffer')
          if (!details.mimeType || !details.filename)
            throw new StackchanError('IO', 'Browser microphone returned no recording format')
          Object.defineProperties(buffer, {
            mimeType: { value: details.mimeType, configurable: true },
            filename: { value: details.filename, configurable: true },
          })
          finish(undefined, buffer)
        } catch (caught) {
          // A failed bridge call leaves ownership uncertain. Release is still
          // attempted, and this microphone cannot transfer its input onward.
          const failure = asStackchanError(caught)
          finish(failure, undefined, confirmedQuiet ? undefined : failure)
        }
      }
      try {
        clearDeadline = scheduleWasmAudioTimer(
          bridge,
          () => {
            stop(new StackchanError('TIMEOUT', 'Browser recording exceeded its preparation and capture deadline'))
          },
          RECORDING_PREPARE_TIMEOUT_MS + Math.ceil(durationMs) + RECORDING_GRACE_MS,
        )
        unsubscribe = options.signal?.subscribe(stop)
      } catch (error) {
        stop(asStackchanError(error))
      }
      if (finished) {
        cleanup([unsubscribe])
        unsubscribe = undefined
      }
      // Avoid nested XS evaluation when the browser reports an immediate result.
      Promise.resolve().then(poll)
    })
  }
}
