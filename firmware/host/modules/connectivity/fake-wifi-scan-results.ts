import type { RawWiFiScanResult } from 'wifi-scan-types'

const FAKE_WIFI_SCAN_RESULTS: readonly RawWiFiScanResult[] = Object.freeze([
  { ssid: 'StackChan-Open', rssi: -38 },
  { ssid: 'StackChan-Secure', rssi: -48 },
  { ssid: 'Workshop-WiFi', rssi: -67 },
])

export function getFakeWiFiScanResults(): RawWiFiScanResult[] {
  return FAKE_WIFI_SCAN_RESULTS.map((result) => ({ ...result }))
}
