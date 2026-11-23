export class LiveSession {
  constructor({ createConversation, createPipeline, networkReady, acquireLowLatency, settings, onState }) {
    Object.assign(this, { createConversation, createPipeline, networkReady, acquireLowLatency, settings, onState })
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
      entry.radio = this.acquireLowLatency()
      const conversation = this.createConversation({
        apiKey: this.settings.apiKey,
        model: this.settings.model,
        voice: this.settings.voice,
        instructions: this.settings.instructions,
        delegation: {
          kind: 'hosted',
          model: this.settings.backendModel ?? 'gpt-6-luna',
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
      entry.pipeline = this.createPipeline(conversation)
      entry.pipeline.setVolume(this.settings.volume ?? 0.1)
      await entry.pipeline.start()
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
      const result = await entry.pipeline?.close({ mode: 'abort' })
      if (result?.remoteFinalization === 'unknown') entry.failure = 'error'
    } catch {
      entry.failure = 'error'
    } finally {
      try {
        entry.radio?.close()
      } catch {
        entry.failure = 'error'
      }
      if (this.active === entry) {
        this.active = undefined
        this.onState(entry.failure ?? 'idle')
      }
    }
  }

  async setMicrophoneMuted(muted) {
    const entry = this.active,
      pipeline = entry?.pipeline
    if (!pipeline || entry.cancelled) return false
    try {
      await pipeline.setMicrophoneMuted(muted)
      entry.muted = muted
      return this.active === entry && !entry.cancelled && entry.muted
    } catch {
      if (this.active === entry) {
        entry.failure = 'error'
        await this.stop()
      }
      return false
    }
  }
}
