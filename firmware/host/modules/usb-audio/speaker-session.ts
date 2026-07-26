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
    this.#reset()
    return true
  }

  reset(): void {
    this.#reset()
  }

  forceStop(): { streamId: number; sampleRate: number } {
    const current = { streamId: this.#streamId, sampleRate: this.#sampleRate }
    this.#reset()
    return current
  }

  #validateCurrent(streamId: number, sampleRate: number, payloadBytes: number): MediaSessionResult {
    return isValidCurrentSpeakerControl(streamId, sampleRate, payloadBytes, this.#streamId, this.#sampleRate)
  }

  #reset(): void {
    this.#streamId = 0
    this.#sampleRate = 0
    this.#ended = false
  }
}
