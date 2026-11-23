import WiFi from 'embedded:network/interface/wifi'
import { createAccountNetwork } from 'muse-setup/account-network'
import silenceLogs from 'muse-wifi-privacy'
import Time from 'time'
import Timer from 'timer'

const connectNative = native('xs_muse_account_wifi')
const wifiReason = native('xs_muse_account_wifi_reason')
const closeWiFi = native('xs_muse_account_wifi_close')
export function createDeviceAccountNetwork(onProgress, onDiagnostic) {
  let watch
  return createAccountNetwork({
    onProgress,
    onDiagnostic,
    createWiFi: (options) => new WiFi(options),
    connectNative(account, generation) {
      watch = connectNative(account, generation)
    },
    wifiFailure() {
      return watch === undefined ? 'none' : wifiReason(watch)
    },
    closeNative() {
      if (watch !== undefined) {
        closeWiFi(watch)
        watch = undefined
      }
    },
    silenceLogs,
    createNTP() {
      const provider = device.network.ntp.client
      return new provider.io({ ...provider, servers: ['pool.ntp.org'] })
    },
    setTime: (value) => Time.set(value),
    setTimer: (callback, ms) => Timer.set(callback, ms),
    clearTimer: (timer) => Timer.clear(timer),
  })
}
