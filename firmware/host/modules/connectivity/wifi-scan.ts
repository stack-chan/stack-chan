import WiFi from 'ecma-wifi'
import type { RawWiFiScanResult, ScanWiFiNetworksOptions, WiFiScanSession } from './wifi-scan-types.js'

export function scanWiFiNetworks(options: ScanWiFiNetworksOptions): WiFiScanSession {
  let wifi: InstanceType<typeof WiFi> | undefined
  let closed = false

  const close = () => {
    if (closed) return
    closed = true
    wifi?.close?.()
  }

  try {
    wifi = new WiFi({})
    wifi.scan({
      onFound: (item: RawWiFiScanResult) => {
        options.onFound?.(item)
      },
      onComplete: () => {
        close()
        options.onComplete?.()
      },
    })
  } catch (error) {
    close()
    options.onError?.(error instanceof Error ? error.message : String(error))
  }

  return { close }
}
