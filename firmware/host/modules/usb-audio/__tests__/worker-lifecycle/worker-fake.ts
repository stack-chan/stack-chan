export default class WorkerFake {
  static get current(): WorkerFake {
    return (globalThis as typeof globalThis & { usbTestWorker: WorkerFake }).usbTestWorker
  }
  onmessage?: (message: Record<string, unknown>) => void
  messages: Record<string, unknown>[] = []
  terminated = false
  constructor(_name: string, _options: Record<string, unknown>) {
    ;(globalThis as typeof globalThis & { usbTestWorker?: WorkerFake }).usbTestWorker = this
  }
  postMessage(message: Record<string, unknown>) {
    this.messages.push(message)
  }
  terminate() {
    this.terminated = true
  }
  emit(message: Record<string, unknown>) {
    this.onmessage?.(message)
  }
  get generation(): number {
    return this.messages.filter((message) => message.id === 'media-state').at(-1)?.generation as number
  }
}

export interface Self {
  onmessage?: (message: Record<string, unknown>) => void
  postMessage(message: Record<string, unknown>): void
  close(): void
}
