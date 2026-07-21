import { DOMAIN } from 'consts'
import { type StartNetworkConnectionOptions, startNetworkConnection, stopNetworkConnection } from 'network-manager'
import Preference from 'preference'

export type StoredWiFiConnectionOptions = Omit<StartNetworkConnectionOptions, 'ssid' | 'password'> & {
  ssid?: string
  password?: string
}

export function readStoredWiFiPreference(key: 'ssid' | 'password'): string {
  const value = Preference.get(DOMAIN.wifi, key)
  return value === undefined || value === null ? '' : String(value)
}

export function connectStoredWiFi(options: StoredWiFiConnectionOptions = {}): boolean {
  const ssid = options.ssid ?? readStoredWiFiPreference('ssid')
  const password = options.password ?? readStoredWiFiPreference('password')
  if (ssid.length === 0) {
    trace('No Wi-Fi SSID\n')
    return false
  }
  if (password.length === 0) {
    trace('No Wi-Fi password\n')
    return false
  }
  startNetworkConnection({
    ...options,
    ssid,
    password,
  })
  return true
}

export function stopStoredWiFiConnection(): void {
  stopNetworkConnection()
}

/** Clears both credentials so even manifest defaults are explicitly overridden on the next boot. */
export function clearStoredWiFiCredentials(): void {
  stopStoredWiFiConnection()
  Preference.set(DOMAIN.wifi, 'ssid', '')
  Preference.set(DOMAIN.wifi, 'password', '')
}
