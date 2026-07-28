import { isValidMicrophoneControl, MediaSessionResult } from 'stackchan-usb-media-session'

export { MediaSessionResult as MicrophoneSessionResult } from 'stackchan-usb-media-session'

export class MicrophoneSessionGuard {
  #streamId = 0
  #lastStoppedStreamId = 0

  get streamId(): number {
    return this.#streamId
  }

  get active(): boolean {
    return this.#streamId !== 0
  }

  start(streamId: number, sampleRate: number, payloadBytes: number): MediaSessionResult {
    if (!isValidMicrophoneControl(streamId, sampleRate, payloadBytes)) return MediaSessionResult.INVALID
    if (this.active) {
      if (streamId === this.#streamId) return MediaSessionResult.IDEMPOTENT
      return MediaSessionResult.BUSY
    }
    this.#streamId = streamId
    return MediaSessionResult.ACCEPTED
  }

  stop(streamId: number, sampleRate: number, payloadBytes: number): MediaSessionResult {
    if (!isValidMicrophoneControl(streamId, sampleRate, payloadBytes)) return MediaSessionResult.INVALID
    if (this.active) {
      if (streamId !== this.#streamId) return MediaSessionResult.STALE
      this.#lastStoppedStreamId = this.#streamId
      this.#streamId = 0
      return MediaSessionResult.ACCEPTED
    }
    if (streamId === this.#lastStoppedStreamId) return MediaSessionResult.IDEMPOTENT
    return MediaSessionResult.STALE
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
