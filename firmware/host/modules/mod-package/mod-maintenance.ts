import Preference from 'preference'

// A host boot request, separate from user settings and never read from mod/config.
const domain = 'stackchan.boot'
const key = 'maintenance'
let active = false

export function isModMaintenanceActive(): boolean {
  return active
}

export function restartInModMaintenance(): void {
  const system = (globalThis as typeof globalThis & { System?: { restart(): void } }).System
  if (!system?.restart) throw new Error('Restart for MOD maintenance is unavailable')
  requestModMaintenance()
  system.restart()
}

export function requestModMaintenance(): void {
  Preference.set(domain, key, 1)
  if (Preference.get(domain, key) !== 1) throw new Error('Could not save MOD maintenance request')
}

export function takeModMaintenanceRequest(): boolean {
  if (Preference.get(domain, key) !== 1) return false
  Preference.delete(domain, key)
  if (Preference.get(domain, key) !== undefined) throw new Error('Could not clear MOD maintenance request')
  active = true
  return true
}
