export class PathCheck {
  constructor({ createRoute, createPipeline, networkReady, schedule, clear, notify, maxMs = 90000 }) {
    this.createRoute = createRoute
    this.createPipeline = createPipeline
    this.networkReady = networkReady
    this.schedule = schedule
    this.clear = clear
    this.notify = notify
    this.maxMs = Number.isFinite(maxMs) ? Math.max(1000, Math.min(300000, maxMs)) : 90000
  }
  start() {
    if (this.active) return this.active.starting
    const entry = { cancelled: false }
    this.active = entry
    this.notify('connecting')
    entry.timer = this.schedule(() => {
      void this.stop()
    }, this.maxMs)
    entry.starting = this.connect(entry)
    return entry.starting
  }
  async connect(entry) {
    try {
      const ready = await this.networkReady
      if (entry.cancelled) return
      if (ready?.status !== 'connected') throw new Error('Network unavailable')
      const route = this.createRoute()
      entry.ptt = route.ptt
      entry.pipeline = this.createPipeline(route.conversation, (event) => {
        if (entry.cancelled) return
        if (event.type === 'error') {
          this.notify('error')
          if (event.fatal) void this.stop()
        } else if (event.type === 'turn.ended')
          this.notify(event.status === 'completed' ? 'turn completed' : 'turn failed')
      })
      await entry.pipeline.start()
      if (!entry.cancelled) {
        entry.ready = true
        this.notify(entry.ptt ? 'ready: record/send' : 'ready: speak')
      }
    } catch {
      if (this.active === entry) {
        this.notify('start failed: check configuration/network')
        await this.stop()
      }
    }
  }
  record() {
    const entry = this.active
    if (!entry?.ptt || !entry.ready || entry.cancelled) return
    entry.recording = !entry.recording
    if (entry.recording) entry.ptt.press()
    else entry.ptt.release()
    this.notify(entry.recording ? 'recording' : 'processing')
  }
  stop() {
    const entry = this.active
    if (!entry) return Promise.resolve()
    if (entry.closing) return entry.closing
    entry.cancelled = true
    this.clear(entry.timer)
    entry.ptt?.release()
    this.notify('closing')
    entry.closing = Promise.resolve().then(async () => {
      try {
        const result = await entry.pipeline?.close({ mode: 'abort' })
        this.notify(result?.remoteFinalization === 'unknown' ? 'closed: remote state unknown' : 'closed')
      } catch {
        this.notify('close failed: remote state unknown')
      } finally {
        if (this.active === entry) this.active = undefined
      }
    })
    return entry.closing
  }
}
