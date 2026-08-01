export type UsbConnectionUpdate = {
  connected: boolean
  changed: boolean
}

/**
 * Converts the USB Serial/JTAG SOF monitor into a stable connection state.
 *
 * A positive observation reconnects immediately. Negative observations must
 * remain continuous for the configured interval because the ESP-IDF monitor
 * can briefly report a missing SOF without the CDC device leaving the host.
 */
export class UsbConnectionDebouncer {
  readonly #disconnectMilliseconds: number
  #connected = false
  #disconnectStartedTicks: number | undefined

  constructor(disconnectMilliseconds: number) {
    if (
      !Number.isInteger(disconnectMilliseconds) ||
      disconnectMilliseconds <= 0 ||
      disconnectMilliseconds > 0x7fffffff
    ) {
      throw new RangeError('USB disconnect debounce must be a positive 31-bit integer')
    }
    this.#disconnectMilliseconds = disconnectMilliseconds
  }

  get connected(): boolean {
    return this.#connected
  }

  update(observedConnected: boolean, ticks: number): UsbConnectionUpdate {
    const now = ticks >>> 0
    if (observedConnected) {
      this.#disconnectStartedTicks = undefined
      if (this.#connected) return { connected: true, changed: false }
      this.#connected = true
      return { connected: true, changed: true }
    }

    if (!this.#connected) return { connected: false, changed: false }
    if (this.#disconnectStartedTicks === undefined) {
      this.#disconnectStartedTicks = now
      return { connected: true, changed: false }
    }
    if ((now - this.#disconnectStartedTicks) >>> 0 < this.#disconnectMilliseconds) {
      return { connected: true, changed: false }
    }

    this.#disconnectStartedTicks = undefined
    this.#connected = false
    return { connected: false, changed: true }
  }
}
