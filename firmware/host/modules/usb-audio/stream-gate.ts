export class CurrentStreamGate {
  #current = 0

  get current(): number {
    return this.#current
  }

  activate(streamId: number): void {
    if (!Number.isInteger(streamId) || streamId <= 0 || streamId > 0xffff) {
      throw new RangeError('stream ID is out of range')
    }
    this.#current = streamId
  }

  isCurrent(streamId: number): boolean {
    return this.#current !== 0 && streamId === this.#current
  }

  runIfCurrent(streamId: number, action: () => void): boolean {
    if (!this.isCurrent(streamId)) return false
    action()
    return true
  }

  clearIfCurrent(streamId: number): boolean {
    if (!this.isCurrent(streamId)) return false
    this.#current = 0
    return true
  }

  reset(): void {
    this.#current = 0
  }
}
