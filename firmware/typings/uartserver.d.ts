declare module 'uartserver' {
  class UARTServer {
    deviceName: string
    notifyValue(characteristic: string, data: ArrayBuffer): void
    onConnected(): void
    onDisconnected(): void
    onRX(data: ArrayBuffer): void
    startAdvertising(params: unknown): void
  }

  const SERVICE_UUID: string

  export { UARTServer, SERVICE_UUID }
}
