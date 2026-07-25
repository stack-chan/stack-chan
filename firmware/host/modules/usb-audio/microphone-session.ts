export enum MicrophoneSessionResult {
  ACCEPTED = 'accepted',
  IDEMPOTENT = 'idempotent',
  STALE = 'stale',
  INVALID = 'invalid',
  BUSY = 'busy',
}

const MICROPHONE_SAMPLE_RATE = 16000

export class MicrophoneSessionGuard {
  #streamId = 0
  #lastStoppedStreamId = 0

  get streamId(): number {
    return this.#streamId
  }

  get active(): boolean {
    return this.#streamId !== 0
  }

  start(streamId: number, sampleRate: number, payloadBytes: number): MicrophoneSessionResult {
    if (!validControl(streamId, sampleRate, payloadBytes)) return MicrophoneSessionResult.INVALID
    if (this.active) {
      if (streamId === this.#streamId) return MicrophoneSessionResult.IDEMPOTENT
      return MicrophoneSessionResult.BUSY
    }
    this.#streamId = streamId
    return MicrophoneSessionResult.ACCEPTED
  }

  stop(streamId: number, sampleRate: number, payloadBytes: number): MicrophoneSessionResult {
    if (!validControl(streamId, sampleRate, payloadBytes)) return MicrophoneSessionResult.INVALID
    if (this.active) {
      if (streamId !== this.#streamId) return MicrophoneSessionResult.STALE
      this.#lastStoppedStreamId = this.#streamId
      this.#streamId = 0
      return MicrophoneSessionResult.ACCEPTED
    }
    if (streamId === this.#lastStoppedStreamId) return MicrophoneSessionResult.IDEMPOTENT
    return MicrophoneSessionResult.STALE
  }

  forceStop(): number {
    const streamId = this.#streamId
    if (streamId !== 0) {
      this.#lastStoppedStreamId = streamId
      this.#streamId = 0
    }
    return streamId
  }

  reset(): void {
    this.#streamId = 0
    this.#lastStoppedStreamId = 0
  }
}

function validControl(streamId: number, sampleRate: number, payloadBytes: number): boolean {
  return (
    Number.isInteger(streamId) &&
    streamId > 0 &&
    streamId <= 0xffff &&
    sampleRate === MICROPHONE_SAMPLE_RATE &&
    payloadBytes === 0
  )
}
