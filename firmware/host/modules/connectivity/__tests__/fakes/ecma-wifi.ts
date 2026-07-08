type WiFiOptions = {
  onChanged?: (this: FakeWiFi, property: string) => void
}

export type WiFiConnectOptions = {
  SSID: string
  password?: string
  secure?: boolean
}

const instances: FakeWiFi[] = []

export default class FakeWiFi {
  static readonly disconnected = 200
  static readonly connecting = 300
  static readonly connected = 400
  static readonly gotIP = 500
  static scanResults: Array<{ ssid: string }> = []

  #onChanged?: (this: FakeWiFi, property: string) => void
  #connection = FakeWiFi.disconnected
  #address = ''
  closed = false
  connectOptions?: WiFiConnectOptions
  disconnectCount = 0

  constructor(options: WiFiOptions = {}) {
    this.#onChanged = options.onChanged
    instances.push(this)
  }

  connect(options: WiFiConnectOptions): void {
    this.connectOptions = options
    this.#connection = FakeWiFi.connecting
    this.#onChanged?.call(this, 'connection')
  }

  disconnect(): void {
    this.disconnectCount += 1
    this.#connection = FakeWiFi.disconnected
    this.#address = ''
    this.#onChanged?.call(this, 'connection')
  }

  close(): void {
    this.closed = true
  }

  scan(options: { onFound?: (item: { ssid: string }) => void; onComplete?: () => void } = {}): void {
    for (const item of FakeWiFi.scanResults) {
      options.onFound?.(item)
    }
    options.onComplete?.()
  }

  emitConnected(): void {
    this.#connection = FakeWiFi.connected
    this.#onChanged?.call(this, 'connection')
  }

  emitGotIP(address = '192.0.2.10'): void {
    this.#connection = FakeWiFi.gotIP
    this.#address = address
    this.#onChanged?.call(this, 'address')
  }

  emitDisconnected(): void {
    this.#connection = FakeWiFi.disconnected
    this.#address = ''
    this.#onChanged?.call(this, 'connection')
  }

  get connection(): number {
    return this.#connection
  }

  get address(): string {
    return this.#address
  }

  get SSID(): string {
    return this.connectOptions?.SSID ?? ''
  }
}

export function resetFakeWiFi(): void {
  instances.length = 0
  FakeWiFi.scanResults = []
}

export function getFakeWiFiInstances(): FakeWiFi[] {
  return instances
}
