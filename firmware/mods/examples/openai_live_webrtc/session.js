export class LiveSession {
  constructor({
    createConversation,
    createPipeline,
    networkReady,
    acquireLowLatency,
    settings,
    reactions,
    onState,
    onStandbyChanged,
  }) {
    Object.assign(this, {
      createConversation,
      createPipeline,
      networkReady,
      acquireLowLatency,
      settings,
      reactions,
      onState,
      onStandbyChanged,
    })
  }

  start(onEnded) {
    if (this.active) return this.active.starting
    const entry = { cancelled: false, onEnded }
    this.active = entry
    this.onState('connecting')
    entry.starting = this.connect(entry)
    return entry.starting
  }

  /** Dispatch synchronously; the owner can close while network readiness is pending. */
  startOwned(onEnded) {
    if (this.active) throw new Error('Conversation already owns audio')
    this.start(onEnded)
    const entry = this.active
    return {
      close: async () => {
        await this.stopEntry(entry)
        if (!entry.localReleased) throw new Error('Conversation audio release unconfirmed')
      },
    }
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
        ...(this.reactions && {
          triggers: this.reactions.triggers,
          onEvent: (event) => {
            if (this.active === entry && !entry.cancelled) this.reactions.receive(event)
          },
        }),
        onStandbyChanged: (standby) => {
          if (this.active !== entry || entry.cancelled) return
          entry.standby = standby
          if (entry.connected) this.onStandbyChanged?.(standby)
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
      entry.connected = true
      this.onState('connected', entry.standby)
      return true
    } catch {
      if (!entry.cancelled) entry.failure = 'error'
      return false
    } finally {
      if (entry.failure && this.active === entry) await this.stop()
    }
  }

  stop() {
    return this.stopEntry(this.active)
  }

  stopEntry(entry) {
    if (!entry) return Promise.resolve()
    if (entry.closing) return entry.closing
    entry.cancelled = true
    entry.closing = Promise.resolve().then(() => this.finish(entry))
    this.onState('closing')
    return entry.closing
  }

  async finish(entry) {
    const motion = this.reactions?.reset()
    try {
      const result = await entry.pipeline?.close({ mode: 'abort' })
      entry.localReleased = true
      if (result?.remoteFinalization === 'unknown') entry.failure = 'error'
    } catch {
      entry.failure = 'error'
    } finally {
      await motion
      try {
        entry.radio?.close()
      } catch {
        entry.failure = 'error'
      }
      if (this.active === entry) {
        this.active = undefined
        this.onState(entry.failure ?? 'idle')
        entry.onEnded?.(entry.failure ? 'error' : 'completed')
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
