// Copyright (c) 2026 Shinya Ishikawa
// SPDX-License-Identifier: Apache-2.0

export function createTransport({ Timer, Native, native, ArrayBuffer: BufferClass }) {
  return class Transport extends Native('xs_live_transport_destructor') {
    #timer
    #callback
    #closing
    #resolveClose
    #released = false
    #finalStats
    #outgoing = []
    #outgoingBytes = 0
    constructor(callback) {
      super()
      this.#callback = callback
      native('xs_live_transport_constructor').call(this)
      // Schedule from completion: replaying expired polls can monopolize XS when
      // the native media tasks temporarily consume a full core.
      this.#timer = Timer.repeat((timer) => {
        this.#poll()
        // Preserve the SDK's exception path; scheduling inside finally can
        // replace a callback error and repeatedly unwind it in XS.
        if (!this.#released) Timer.schedule(timer, 20, 20)
      }, 20)
    }
    start(options) {
      native('xs_live_transport_start').call(this, options?.captureOnly === true)
    }
    acceptAnswer(sdp) {
      native('xs_live_transport_answer').call(this, sdp)
    }
    send(data) {
      if (this.#closing || this.#released) throw new Error('Transport is closed')
      const bytes = BufferClass.fromString(data).byteLength
      if (bytes > 65536 || this.#outgoing.length >= 32 || this.#outgoingBytes + bytes > 131072)
        throw new Error('WebRTC outgoing event limit exceeded')
      this.#outgoing.push({ data, bytes })
      this.#outgoingBytes += bytes
      // Stop local audio promptly on an explicit close, while DTLS/DataChannel
      // remain alive to receive final usage and session.closed.
      if (data.includes('"session.close"') && JSON.parse(data).type === 'session.close')
        native('xs_live_audio_quiesce').call(this)
      this.#flush()
    }
    #flush() {
      while (this.#outgoing.length) {
        const { data, bytes } = this.#outgoing[0]
        if (!native('xs_live_transport_send').call(this, data)) break
        this.#outgoing.shift()
        this.#outgoingBytes -= bytes
      }
    }
    setMuted(value) {
      native('xs_live_transport_mute').call(this, value)
    }
    setVolume(value) {
      native('xs_live_transport_volume').call(this, value)
    }
    get stats() {
      return this.#released ? this.#finalStats : native('xs_live_transport_stats').call(this)
    }
    get diagnostics() {
      return native('xs_live_transport_diagnostics').call(this)
    }
    close() {
      if (this.#closing) return this.#closing
      if (this.#released) return Promise.resolve()
      this.#closing = new Promise((resolve) => {
        this.#resolveClose = resolve
      })
      this.#outgoing.length = 0
      this.#outgoingBytes = 0
      native('xs_live_transport_close').call(this)
      return this.#closing
    }
    #poll() {
      if (!this.#closing) {
        try {
          this.#flush()
        } catch {
          this.#callback?.({ type: 'error', code: -1, stage: 'send' })
        }
      }
      for (let i = 0; i < 16; i++) {
        const event = native('xs_live_transport_read').call(this)
        if (!event) break
        if (event.type === 'released') {
          Timer.clear(this.#timer)
          this.#finalStats = native('xs_live_transport_stats').call(this)
          this.#released = true
          native('xs_live_transport_release').call(this)
          this.#resolveClose?.()
          this.#callback = undefined
          break
        }
        // This CoreS3 peer must initiate DTLS. Advertising actpass can leave both
        // peers waiting and starve the JS transport poll during negotiation.
        if (event.type === 'offer') event.sdp = event.sdp.replace(/^a=setup:actpass(\r?)$/gm, 'a=setup:active$1')
        this.#callback?.(event)
      }
    }
  }
}
