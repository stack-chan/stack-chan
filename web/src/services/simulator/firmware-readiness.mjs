export class FirmwareReadiness {
  constructor({ onReady, onTimeout, setTimer = setTimeout, clearTimer = clearTimeout }) {
    this.onReady = onReady
    this.onTimeout = onTimeout
    this.setTimer = setTimer
    this.clearTimer = clearTimer
    this.pendingInstallation = null
    this.timer = null
  }

  start(installation) {
    this.clear()
    this.pendingInstallation = installation
  }

  onTrace(text) {
    if (!this.pendingInstallation) return
    const line = String(text)
    if (line.includes('[main] app behaviors ready')) {
      const installation = this.pendingInstallation
      this.clear()
      this.onReady(installation)
    } else if (line.includes('[main] onLaunch shouldCreateContext=true') && this.timer === null) {
      // The splash and settings screens may remain open indefinitely by user choice.
      // Only time the application boot after the user leaves those screens.
      this.timer = this.setTimer(() => {
        if (!this.pendingInstallation) return
        this.clear()
        this.onTimeout()
      }, 30_000)
    }
  }

  clear() {
    if (this.timer !== null) this.clearTimer(this.timer)
    this.timer = null
    this.pendingInstallation = null
  }
}
