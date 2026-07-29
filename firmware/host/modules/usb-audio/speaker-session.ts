import {
  isValidCurrentSpeakerControl,
  isValidSpeakerStartControl,
  MediaSessionResult,
} from 'stackchan-usb-media-session'

export { MediaSessionResult as SpeakerSessionResult } from 'stackchan-usb-media-session'

export class SpeakerSessionGuard {
  #streamId = 0
  #sampleRate = 0
  #ended = false
  #lastFinishedStreamId = 0
  #lastFinishedSampleRate = 0

  get streamId(): number {
    return this.#streamId
  }

  get sampleRate(): number {
    return this.#sampleRate
  }

  get active(): boolean {
    return this.#streamId !== 0
  }

  get ended(): boolean {
    return this.#ended
  }

  start(streamId: number, sampleRate: number, payloadBytes: number): MediaSessionResult {
    if (!isValidSpeakerStartControl(streamId, sampleRate, payloadBytes)) {
      return MediaSessionResult.INVALID
    }
    if (this.active) {
      if (streamId === this.#streamId && sampleRate === this.#sampleRate && !this.#ended) {
        return MediaSessionResult.IDEMPOTENT
      }
      return MediaSessionResult.BUSY
    }
    this.#streamId = streamId
    this.#sampleRate = sampleRate
    this.#ended = false
    return MediaSessionResult.ACCEPTED
  }

  end(streamId: number, sampleRate: number, payloadBytes: number): MediaSessionResult {
    const current = this.#validateCurrent(streamId, sampleRate, payloadBytes)
    if (current !== MediaSessionResult.ACCEPTED) return current
    if (this.#ended) return MediaSessionResult.IDEMPOTENT
    this.#ended = true
    return MediaSessionResult.ACCEPTED
  }

  abort(streamId: number, sampleRate: number, payloadBytes: number): MediaSessionResult {
    const current = this.#validateCurrent(streamId, sampleRate, payloadBytes)
    if (current !== MediaSessionResult.ACCEPTED) return current
    return MediaSessionResult.ACCEPTED
  }

  validateData(streamId: number, sampleRate: number, payloadBytes: number): MediaSessionResult {
    const current = this.#validateCurrent(streamId, sampleRate, 0)
    if (current !== MediaSessionResult.ACCEPTED) return current
    if (this.#ended || payloadBytes <= 0 || payloadBytes % 2 !== 0) return MediaSessionResult.INVALID
    return MediaSessionResult.ACCEPTED
  }

  validateText(streamId: number, sampleRate: number, payloadBytes: number): MediaSessionResult {
    const current = this.#validateCurrent(streamId, sampleRate, 0)
    if (current !== MediaSessionResult.ACCEPTED) return current
    if (this.#ended || payloadBytes <= 0) return MediaSessionResult.INVALID
    return MediaSessionResult.ACCEPTED
  }

  clear(streamId: number): boolean {
    if (streamId !== this.#streamId || !this.active) return false
    this.#finish()
    return true
  }

  reset(): void {
    this.#streamId = 0
    this.#sampleRate = 0
    this.#ended = false
    this.#lastFinishedStreamId = 0
    this.#lastFinishedSampleRate = 0
  }

  forceStop(): { streamId: number; sampleRate: number } {
    const current = { streamId: this.#streamId, sampleRate: this.#sampleRate }
    this.#finish()
    return current
  }

  #validateCurrent(streamId: number, sampleRate: number, payloadBytes: number): MediaSessionResult {
    if (!isValidSpeakerStartControl(streamId, sampleRate, payloadBytes)) return MediaSessionResult.INVALID
    if (!this.active) {
      if (streamId !== this.#lastFinishedStreamId) return MediaSessionResult.STALE
      return sampleRate === this.#lastFinishedSampleRate ? MediaSessionResult.IDEMPOTENT : MediaSessionResult.INVALID
    }
    return isValidCurrentSpeakerControl(streamId, sampleRate, payloadBytes, this.#streamId, this.#sampleRate)
  }

  #finish(): void {
    if (this.#streamId !== 0) {
      this.#lastFinishedStreamId = this.#streamId
      this.#lastFinishedSampleRate = this.#sampleRate
    }
    this.#streamId = 0
    this.#sampleRate = 0
    this.#ended = false
  }
}
