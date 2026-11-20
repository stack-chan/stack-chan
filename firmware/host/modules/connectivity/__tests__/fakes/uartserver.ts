export const SERVICE_UUID = 'test-service'

export let lastUARTServer: UARTServer | undefined

export class UARTServer {
  advertisingStarts: unknown[] = []
  closed = false
  deviceName = ''
  notifications: { characteristic: unknown; value: ArrayBuffer }[] = []

  constructor() {
    lastUARTServer = this
  }

  onConnected(): void {}

  startAdvertising(options: unknown): void {
    this.advertisingStarts.push(options)
  }

  notifyValue(characteristic: unknown, value: ArrayBuffer): void {
    this.notifications.push({ characteristic, value })
  }

  close(): void {
    this.closed = true
  }
}
