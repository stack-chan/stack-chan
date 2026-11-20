import { getFakeWiFiScanResults } from 'fake-wifi-scan-results'
import Timer from 'timer'
import type { RawWiFiScanResult } from 'wifi-scan-types'

type WiFiOptions = {
  onChanged?: (this: SimWiFi, property: string) => void
}

type WiFiConnectOptions = {
  SSID?: string
}

type WiFiScanOptions = {
  onFound?: (item: RawWiFiScanResult) => void
  onComplete?: () => void
}

export default class SimWiFi {
  static readonly disconnected = 200
  static readonly connecting = 300
  static readonly connected = 400
  static readonly gotIP = 500

  #onChanged?: (this: SimWiFi, property: string) => void
  #connection = SimWiFi.disconnected
  #address = ''
  #ssid = ''
  #connectTimer
  #gotIpTimer

  constructor(options: WiFiOptions = {}) {
    this.#onChanged = options.onChanged
  }

  connect(options: WiFiConnectOptions): void {
    this.#ssid = options.SSID ?? ''
    this.#setConnection(SimWiFi.connecting)
    this.#connectTimer = Timer.set(() => {
      this.#connectTimer = undefined
      this.#setConnection(SimWiFi.connected)
      this.#gotIpTimer = Timer.set(() => {
        this.#gotIpTimer = undefined
        this.#address = '192.0.2.10'
        this.#setConnection(SimWiFi.gotIP, 'address')
      }, 1)
    }, 1)
  }

  disconnect(): void {
    this.#clearTimers()
    this.#address = ''
    this.#setConnection(SimWiFi.disconnected)
  }

  close(): void {
    this.#clearTimers()
  }

  scan(options: WiFiScanOptions = {}): void {
    for (const result of getFakeWiFiScanResults()) {
      options.onFound?.(result)
    }
    options.onComplete?.()
  }

  get connection(): number {
    return this.#connection
  }

  get address(): string {
    return this.#address
  }

  get SSID(): string {
    return this.#ssid
  }

  #setConnection(connection: number, property = 'connection'): void {
    this.#connection = connection
    this.#onChanged?.call(this, property)
  }

  #clearTimers(): void {
    if (this.#connectTimer != null) {
      Timer.clear(this.#connectTimer)
      this.#connectTimer = undefined
    }
    if (this.#gotIpTimer != null) {
      Timer.clear(this.#gotIpTimer)
      this.#gotIpTimer = undefined
    }
  }
}
