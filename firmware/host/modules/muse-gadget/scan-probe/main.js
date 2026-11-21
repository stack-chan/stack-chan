import { startDeviceWiFiScan } from 'muse-pairing/device-wifi-scan'
import Timer from 'timer'

Timer.set(async () => {
  trace('MUSE_SCAN start\n')
  let scan
  try {
    scan = startDeviceWiFiScan()
    const networks = await scan.promise
    trace(`MUSE_SCAN count_${networks.length}\n`)
  } catch {
    trace('MUSE_SCAN failed\n')
  } finally {
    scan?.close()
    trace('MUSE_SCAN closed\n')
  }
}, 1000)
