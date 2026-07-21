export enum SpeakerSessionResult {
  ACCEPTED = 'accepted',
  IDEMPOTENT = 'idempotent',
  STALE = 'stale',
  INVALID = 'invalid',
  BUSY = 'busy',
}

const SUPPORTED_SAMPLE_RATES = new Set([8000, 16000, 24000])

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

  start(streamId: number, sampleRate: number, payloadBytes: number): SpeakerSessionResult {
    if (!validStreamId(streamId) || !SUPPORTED_SAMPLE_RATES.has(sampleRate) || payloadBytes !== 0) {
      return SpeakerSessionResult.INVALID
    }
    if (this.active) {
      if (streamId === this.#streamId && sampleRate === this.#sampleRate && !this.#ended) {
        return SpeakerSessionResult.IDEMPOTENT
      }
      return SpeakerSessionResult.BUSY
    }
    this.#streamId = streamId
    this.#sampleRate = sampleRate
    this.#ended = false
    return SpeakerSessionResult.ACCEPTED
  }

  end(streamId: number, sampleRate: number, payloadBytes: number): SpeakerSessionResult {
    const current = this.#validateCurrent(streamId, sampleRate, payloadBytes)
    if (current !== SpeakerSessionResult.ACCEPTED) return current
    if (this.#ended) return SpeakerSessionResult.IDEMPOTENT
    this.#ended = true
    return SpeakerSessionResult.ACCEPTED
  }

  abort(streamId: number, sampleRate: number, payloadBytes: number): SpeakerSessionResult {
    const current = this.#validateCurrent(streamId, sampleRate, payloadBytes)
    if (current !== SpeakerSessionResult.ACCEPTED) return current
    return SpeakerSessionResult.ACCEPTED
  }

  validateData(streamId: number, sampleRate: number, payloadBytes: number): SpeakerSessionResult {
    const current = this.#validateCurrent(streamId, sampleRate, 0)
    if (current !== SpeakerSessionResult.ACCEPTED) return current
    if (this.#ended || payloadBytes <= 0 || payloadBytes % 2 !== 0) return SpeakerSessionResult.INVALID
    return SpeakerSessionResult.ACCEPTED
  }

  validateText(streamId: number, sampleRate: number, payloadBytes: number): SpeakerSessionResult {
    const current = this.#validateCurrent(streamId, sampleRate, 0)
    if (current !== SpeakerSessionResult.ACCEPTED) return current
    if (this.#ended || payloadBytes <= 0) return SpeakerSessionResult.INVALID
    return SpeakerSessionResult.ACCEPTED
  }

  clear(streamId: number): boolean {
    if (streamId !== this.#streamId || !this.active) return false
    this.#reset()
    return true
  }

  reset(): void {
    this.#reset()
  }

  #validateCurrent(streamId: number, sampleRate: number, payloadBytes: number): SpeakerSessionResult {
    if (!this.active) return SpeakerSessionResult.INVALID
    if (streamId !== this.#streamId) return SpeakerSessionResult.STALE
    if (sampleRate !== this.#sampleRate || payloadBytes !== 0) return SpeakerSessionResult.INVALID
    return SpeakerSessionResult.ACCEPTED
  }

  #reset(): void {
    this.#streamId = 0
    this.#sampleRate = 0
    this.#ended = false
  }
}

function validStreamId(streamId: number): boolean {
  return Number.isInteger(streamId) && streamId > 0 && streamId <= 0xffff
}
