declare module 'uartserver' {
  class UARTServer {
    deviceName: string
    notifyValue(characteristic: string, data: ArrayBuffer): void
    onConnected(): void
    onDisconnected(): void
    onRX(data: ArrayBuffer): void
  }

  export { UARTServer }
}
