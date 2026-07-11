export const SERVICE_UUID = '00000000-0000-0000-0000-000000000000'

export class UARTServer {
  deviceName = ''
  advertisingStarts = 0
  notifications: Array<{ characteristic: unknown; value: ArrayBuffer }> = []

  onConnected(): void {}

  startAdvertising(_options?: unknown): void {
    this.advertisingStarts += 1
  }

  notifyValue(characteristic: unknown, value: ArrayBuffer): void {
    this.notifications.push({ characteristic, value })
  }
}
