import WiFi from 'embedded:network/interface/wifi'
import power, { initializeWiFiPowerPolicy, reapplyWiFiPowerPolicy } from 'network-power'
import { assert, equal } from 'testing/assert'
import driver from 'wifi-power-save'

const wifi = new WiFi({})
initializeWiFiPowerPolicy()
equal(power.getWiFiPowerSaveMode(), 'min-modem', 'initial idle')
for (let i = 0; i < 20; i++) {
  const old = power.acquireLowLatency()
  const current = power.acquireLowLatency()
  equal(power.getWiFiPowerSaveMode(), 'none', 'active')
  old.close()
  old.close()
  reapplyWiFiPowerPolicy()
  equal(power.getWiFiPowerSaveMode(), 'none', 'overlap and reapply')
  current.close()
  equal(power.getWiFiPowerSaveMode(), 'min-modem', 'idle again')
}
let rejected = false
try {
  driver.setMode('invalid')
} catch {
  rejected = true
}
assert(rejected, 'reject invalid modes')
equal(power.getWiFiPowerSaveMode(), 'min-modem', 'invalid mode leaves state unchanged')
wifi.close()
trace('@@STACKCHAN_TEST:PASS@@ Wi-Fi native policy 20 cycles\n')
