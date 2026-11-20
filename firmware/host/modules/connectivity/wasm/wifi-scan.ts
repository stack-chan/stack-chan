import { getFakeWiFiScanResults } from 'fake-wifi-scan-results'
import type { ScanWiFiNetworksOptions, WiFiScanSession } from 'wifi-scan-types'

export function scanWiFiNetworks(options: ScanWiFiNetworksOptions): WiFiScanSession {
  for (const result of getFakeWiFiScanResults()) {
    options.onFound?.(result)
  }
  options.onComplete?.()
  return {
    close() {},
  }
}
