import WiFi from 'embedded:network/interface/wifi'
import silenceLogs from 'muse-wifi-privacy'
import TextEncoder from 'text/encoder'
import Timer from 'timer'
import { startWiFiScan } from './wifi-scan.js'
export function startDeviceWiFiScan() {
  const encoder = new TextEncoder()
  return startWiFiScan({
    createWiFi: (options) => new WiFi(options),
    silenceLogs,
    byteLength: (value) => encoder.encode(value).byteLength,
    setTimer: (callback, ms) => Timer.set(callback, ms),
    clearTimer: (timer) => Timer.clear(timer),
  })
}
