// Conversation owns the protocol, native media and HTTP worker. This adapter
// only coordinates the host's audio/radio ownership and explicit user actions.
export class LiveSession {
  constructor({ Conversation, audio, networkReady, acquireLowLatency, amp, settings, onState }) {
    Object.assign(this, { Conversation, audio, networkReady, acquireLowLatency, amp, settings, onState })
  }

  start() {
    if (this.active) return this.active.starting
    const entry = { cancelled: false }
    this.active = entry
    this.onState('connecting')
    entry.starting = this.connect(entry)
    return entry.starting
  }

  async connect(entry) {
    try {
      if (typeof this.settings.apiKey !== 'string' || !this.settings.apiKey.trim()) {
        entry.failure = 'configuration'
        return false
      }
      const ready = await this.networkReady
      if (entry.cancelled || this.active !== entry) return false
      if (ready?.status !== 'connected') throw new Error('network unavailable')
      entry.releaseAudio = this.audio.acquireExclusive()
      entry.radio = this.acquireLowLatency()
      // The CoreS3 SDK amplifier has a setter but no sample-rate getter.
      // Return it to the SDK's 24 kHz baseline after native audio has stopped.
      entry.ampChanged = true
      this.amp.sampleRate = 48000
      const conversation = new this.Conversation({
        apiKey: this.settings.apiKey,
        model: this.settings.model,
        voice: this.settings.voice,
        instructions: this.settings.instructions,
        delegation: {
          type: 'responses',
          responses: { model: this.settings.backendModel ?? 'gpt-6-luna' },
        },
        onError: () => {
          if (this.active !== entry) return
          entry.failure = 'error'
          void this.stop()
        },
        onStateChanged: (state) => {
          if (this.active !== entry) return
          if (state === 'closed' || state === 'error') void this.stop()
        },
      })
      entry.conversation = conversation
      conversation.setVolume(this.settings.volume ?? 0.1)
      await conversation.connect()
      if (entry.cancelled || this.active !== entry) return false
      this.onState('connected')
      return true
    } catch {
      if (!entry.cancelled) entry.failure = 'error'
      return false
    } finally {
      if (entry.failure && this.active === entry) await this.stop()
    }
  }

  stop() {
    const entry = this.active
    if (!entry) return Promise.resolve()
    if (entry.closing) return entry.closing
    entry.cancelled = true
    this.onState('closing')
    entry.closing = this.finish(entry)
    return entry.closing
  }

  async finish(entry) {
    try {
      const result = await entry.conversation?.close()
      if (result && !result.finalized) entry.failure = 'error'
    } catch {
      entry.failure = 'error'
    } finally {
      for (const release of [
        () => {
          if (entry.ampChanged) this.amp.sampleRate = 24000
        },
        () => entry.radio?.close(),
        () => entry.releaseAudio?.(),
      ]) {
        try {
          release()
        } catch {
          entry.failure = 'error'
        }
      }
      if (this.active === entry) {
        this.active = undefined
        this.onState(entry.failure ?? 'idle')
      }
    }
  }

  async setMuted(muted) {
    const entry = this.active,
      conversation = entry?.conversation
    if (!conversation || entry.cancelled) return false
    try {
      await conversation.setMuted(muted)
      return this.active === entry && !entry.cancelled && conversation.muted
    } catch {
      if (this.active === entry) {
        entry.failure = 'error'
        await this.stop()
      }
      return false
    }
  }
}
