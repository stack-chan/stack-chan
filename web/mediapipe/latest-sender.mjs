import { TRACKING_MESSAGE_TYPE } from './tracking.mjs'

export class LatestTrackingSender {
  #inFlight = false
  #latest
  #peerId
  #session

  constructor(session, peerId) {
    this.#session = session
    this.#peerId = peerId
  }

  queue(payload) {
    this.#latest = payload
  }

  async flush() {
    if (this.#inFlight || !this.#latest) return false
    const payload = this.#latest
    this.#latest = undefined
    this.#inFlight = true
    try {
      await this.#session.send(this.#peerId, TRACKING_MESSAGE_TYPE, payload)
      return true
    } finally {
      this.#inFlight = false
    }
  }

  clear() {
    this.#latest = undefined
  }
}
