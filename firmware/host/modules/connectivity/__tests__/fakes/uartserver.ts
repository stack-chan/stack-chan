export const SERVICE_UUID = 'test-service'

export class UARTServer {
  deviceName = ''
  notifications: { characteristic: unknown; value: ArrayBuffer }[] = []

  onConnected(): void {}

  startAdvertising(_options: unknown): void {}

  notifyValue(characteristic: unknown, value: ArrayBuffer): void {
    this.notifications.push({ characteristic, value })
  }
}
