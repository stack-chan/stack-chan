import type { UsbEventSendResult } from 'stackchan-usb-event-transport'

type PendingEventSend = {
  resolve(result: UsbEventSendResult): void
  reject(error: Error): void
}

export type UsbEventSendRequest = {
  requestId: number
  result: Promise<UsbEventSendResult>
}

export class UsbEventSendRequests {
  #sequence = 0
  #pending = new Map<number, PendingEventSend>()

  begin(): UsbEventSendRequest {
    const requestId = this.#nextRequestId()
    return {
      requestId,
      result: new Promise((resolve, reject) => {
        this.#pending.set(requestId, { resolve, reject })
      }),
    }
  }

  resolve(requestId: number, result: UsbEventSendResult): boolean {
    const pending = this.#pending.get(requestId)
    if (!pending) return false
    this.#pending.delete(requestId)
    pending.resolve(result)
    return true
  }

  reject(requestId: number, error: Error): boolean {
    const pending = this.#pending.get(requestId)
    if (!pending) return false
    this.#pending.delete(requestId)
    pending.reject(error)
    return true
  }

  settleAll(result: UsbEventSendResult): void {
    const pending = [...this.#pending.values()]
    this.#pending.clear()
    for (const request of pending) request.resolve(result)
  }

  rejectAll(error: Error): void {
    const pending = [...this.#pending.values()]
    this.#pending.clear()
    for (const request of pending) request.reject(error)
  }

  #nextRequestId(): number {
    do {
      this.#sequence = (this.#sequence + 1) >>> 0
      if (this.#sequence === 0) this.#sequence = 1
    } while (this.#pending.has(this.#sequence))
    return this.#sequence
  }
}
