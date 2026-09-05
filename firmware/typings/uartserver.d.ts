declare module 'uartserver' {
  class UARTServer {
    close(): void
    deviceName: string
    notifyValue(characteristic: { name: string }, data: ArrayBuffer): void
    onConnected(): void
    onDisconnected(): void
    onRX(data: ArrayBuffer): void
    startAdvertising(params: unknown): void
  }

  const SERVICE_UUID: string

  export { UARTServer, SERVICE_UUID }
}
