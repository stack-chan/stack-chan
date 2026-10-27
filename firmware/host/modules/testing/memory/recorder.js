// A bounded set of one-shot observations. Only the diagnostic MOD creates this.
export class MemoryRecorder {
  constructor({ snapshot, write, setTimeout, clearTimeout }) {
    Object.assign(this, { snapshot, write, setTimeout, clearTimeout })
    this.cycle = 0
    this.sequence = 0
    this.state = 'idle'
  }

  sample(phase) {
    // Diagnostic failures must not interfere with audio/radio cleanup.
    try {
      const memory = this.snapshot()
      this.write(
        `[stackchan-memory] ${JSON.stringify({
          schema: 1,
          cycle: this.cycle,
          sequence: ++this.sequence,
          phase,
          state: this.state,
          ...memory,
        })}\n`,
      )
    } catch {
      // Do not report a synthetic measurement or a hardware PASS.
    }
  }

  onState(state) {
    try {
      if (this.timer !== undefined) this.clearTimeout(this.timer)
    } catch {
      // Stale callbacks also check state/cycle below.
    }
    this.timer = undefined
    this.state = state
    if (state === 'connecting') {
      this.cycle++
      this.sample('before-connect')
    } else if (state === 'connected') {
      this.sample('connected')
      this.after(5000, 'duplex')
    } else if (state === 'closing') {
      this.sample('before-close')
    } else {
      // LiveSession emits idle/error/configuration after awaited close and leases.
      this.sample('after-close')
      this.after(1000, 'settled')
    }
  }

  onNegotiating() {
    if (this.state !== 'connecting') return
    // Called after Conversation.connect() starts native transport, not during
    // LiveSession's potentially unbounded network-readiness wait.
    this.sample('negotiating')
    this.after(250, 'connecting')
  }

  after(delay, phase) {
    const cycle = this.cycle,
      state = this.state
    try {
      this.timer = this.setTimeout(() => {
        if (this.cycle !== cycle || this.state !== state) return
        this.timer = undefined
        this.sample(phase)
      }, delay)
    } catch {
      // Timer allocation can fail under the memory pressure being measured.
    }
  }
}
