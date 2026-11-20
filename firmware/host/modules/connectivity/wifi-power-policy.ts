export type WiFiPowerSaveMode = 'none' | 'min-modem'
export type LowLatencyLease = { close(): void }
export type WiFiPowerDriver = {
  setMode(mode: WiFiPowerSaveMode): void
  getMode(): WiFiPowerSaveMode
}

/** One policy per main VM. Workers request leases through their main owner. */
export class WiFiPowerPolicy {
  #driver?: WiFiPowerDriver
  #leases = new Set<object>()

  initialize(driver?: WiFiPowerDriver): void {
    this.#driver = driver
    this.reapply()
  }

  getMode(): WiFiPowerSaveMode | undefined {
    return this.#driver?.getMode()
  }

  reapply(): void {
    const mode = this.#leases.size ? 'none' : 'min-modem'
    if (this.#driver && this.#driver.getMode() !== mode) this.#driver.setMode(mode)
  }

  acquireLowLatency(): LowLatencyLease {
    const token = {}
    this.#leases.add(token)
    try {
      this.reapply()
    } catch (error) {
      this.#leases.delete(token)
      // A failed readback may follow a successful write. Restore the request
      // that was in force before this acquire, retaining the original error.
      try {
        this.reapply()
      } catch {}
      throw error
    }
    return {
      close: () => {
        if (!this.#leases.delete(token)) return
        // Remove ownership even on driver failure. A later connection boundary
        // reapplies the desired mode; never retain an unreachable phantom lease.
        this.reapply()
      },
    }
  }
}
