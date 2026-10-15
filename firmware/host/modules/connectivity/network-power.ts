import Modules from 'modules'
import { type WiFiPowerDriver, WiFiPowerPolicy } from 'wifi-power-policy'

const policy = new WiFiPowerPolicy()

/** Call only after the Wi-Fi driver has initialized, from the main VM. */
export function initializeWiFiPowerPolicy(): void {
  const driver = Modules.has('wifi-power-save') ? (Modules.importNow('wifi-power-save') as WiFiPowerDriver) : undefined
  policy.initialize(driver)
}

export function acquireLowLatency() {
  return policy.acquireLowLatency()
}

/** Actual driver state; undefined on targets without this capability. */
export function getWiFiPowerSaveMode() {
  return policy.getMode()
}

export function reapplyWiFiPowerPolicy(): void {
  policy.reapply()
}

export default { acquireLowLatency, getWiFiPowerSaveMode }
