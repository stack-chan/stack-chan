// SPDX-License-Identifier: Apache-2.0
/** Piu timer lifecycle kept separate so tests exercise the same controller. */
export class FaceDriver {
  constructor(render) {
    this.render = render
    this.bound = false
    this.content = null
    this.paused = false
    this.disposed = false
    this.enabled = true
    this.elapsed = 0
    this.lastTime = 0
  }
  get displayed() {
    if (this.disposed) return false
    // SDK 9.5.0 has no onUndisplaying callback. Native unbind suspends
    // registered timers; application reflects attachment synchronously.
    if (this.content && 'application' in this.content) return !!this.content.application
    return this.bound
  }
  isVisible(content) {
    for (let node = content; node; node = node.container) if (!node.visible) return false
    return true
  }
  sync(content) {
    this.lastTime = content.time
    if (this.displayed && !this.paused && !this.disposed && this.enabled && this.isVisible(content)) content.start()
    else content.stop()
  }
  display(content) {
    if (this.disposed) return
    this.content = content
    this.bound = true
    this.sync(content)
    if (!this.paused) this.render()
  }
  undisplay(content) {
    this.bound = false
    content.stop()
  }
  motions(content, enabled) {
    if (this.disposed) return
    this.enabled = enabled
    this.sync(content)
    if (!this.paused) this.render()
  }
  pause(content) {
    this.paused = true
    content.stop()
    content.visible = content.active = false
  }
  resume(content) {
    if (this.disposed) return
    this.paused = false
    content.visible = content.active = true
    this.sync(content)
    this.render()
  }
  tick(content) {
    if (!this.displayed || this.disposed || this.paused || !this.enabled || !this.isVisible(content)) {
      content.stop()
      return
    }
    this.elapsed += Math.max(0, Math.min(100, content.time - this.lastTime))
    this.lastTime = content.time
    this.render()
  }
  openness() {
    if (!this.enabled) return 1
    const t = this.elapsed % 4000
    return t < 2800 ? 1 : t < 2890 ? 1 - (t - 2800) / 90 : t < 2935 ? 0 : t < 3135 ? (t - 2935) / 200 : 1
  }
  dispose(content) {
    this.disposed = true
    this.bound = false
    content.stop()
    content.visible = content.active = false
  }
}
