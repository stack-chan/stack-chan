import { encodeTrackingPayload, TRACKING_MESSAGE_TYPE } from './tracking.mjs'

export const TRACKING_SEND_INTERVAL_MS = 100

export class LatestTrackingSender {
  #inFlight = false
  #latest
  #faceDirty = false
  #session

  constructor(session) {
    this.#session = session
  }

  queue(payload) {
    this.#latest = payload
    this.#faceDirty = true
  }

  async flush() {
    if (this.#inFlight || !this.#latest || !this.#faceDirty) return false
    const state = this.#latest
    const payload = encodeTrackingPayload(state, { includeEmotion: true, includeHands: true, includeFaceParts: true })
    this.#faceDirty = false
    this.#inFlight = true
    try {
      await this.#session.broadcast(TRACKING_MESSAGE_TYPE, payload)
      return true
    } catch (error) {
      if (this.#latest === state) this.#faceDirty = true
      throw error
    } finally {
      this.#inFlight = false
    }
  }

  clear() {
    this.#latest = undefined
    this.#faceDirty = false
  }
}
