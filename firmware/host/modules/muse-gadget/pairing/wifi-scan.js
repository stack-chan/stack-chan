export function startWiFiScan({ createWiFi, silenceLogs, byteLength, setTimer, clearTimer }) {
  let wifi,
    timer,
    done = false,
    resolve,
    reject
  const networks = []
  const promise = new Promise((ok, fail) => {
    resolve = ok
    reject = fail
  })
  function finish(error) {
    if (done) return
    done = true
    if (timer !== undefined) clearTimer(timer)
    try {
      wifi?.close()
    } catch {
      error = true
    }
    if (error) {
      networks.length = 0
      reject(new Error('wifi_scan_failed'))
    } else {
      const result = networks.slice()
      networks.length = 0
      resolve(result)
    }
  }
  try {
    silenceLogs()
    wifi = createWiFi({})
    timer = setTimer(() => finish(true), 15000)
    wifi.scan({
      onFound(item) {
        if (done) return
        const ssid = item.SSID,
          rssi = item.RSSI
        if (
          typeof ssid !== 'string' ||
          !ssid.length ||
          ssid.includes('\0') ||
          byteLength(ssid) > 32 ||
          !Number.isInteger(rssi) ||
          rssi < -127 ||
          rssi > 0 ||
          typeof item.security !== 'string'
        )
          return
        const secure = item.security !== 'none'
        const old = networks.findIndex((value) => value.ssid === ssid)
        if (old >= 0) {
          if (networks[old].rssi >= rssi) return
          networks.splice(old, 1)
        }
        networks.push({ ssid, rssi, secure })
        networks.sort((a, b) => b.rssi - a.rssi)
        if (networks.length > 16) networks.length = 16
      },
      onComplete() {
        finish(false)
      },
    })
  } catch {
    finish(true)
  }
  return {
    promise,
    close() {
      finish(true)
    },
  }
}
