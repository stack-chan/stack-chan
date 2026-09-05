/** Synchronous device ownership; host scopes may await the containing driver. */
export class ServoDriverResources {
  #devices: { close: () => void }[] = []
  #closed = false
  get closed(): boolean {
    return this.#closed
  }

  own<T extends { close: () => void }>(device: T): T {
    this.#devices.push(device)
    return device
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    const devices = this.#devices
    this.#devices = []
    let failed = false
    let failure: unknown
    for (let index = devices.length - 1; index >= 0; index--) {
      try {
        devices[index].close()
      } catch (error) {
        if (!failed) {
          failed = true
          failure = error
        }
      }
    }
    if (failed) throw failure
  }

  rollback(error: unknown): never {
    try {
      this.close()
    } catch {
      /* Preserve the constructor failure. */
    }
    throw error
  }
}
