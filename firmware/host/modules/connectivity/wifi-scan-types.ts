export type RawWiFiScanResult = {
  ssid?: string
  SSID?: string
  rssi?: number
  RSSI?: number
}

export type ScanWiFiNetworksOptions = {
  onFound?: (item: RawWiFiScanResult) => void
  onComplete?: () => void
  onError?: (message?: string) => void
}

export type WiFiScanSession = {
  close(): void
}
