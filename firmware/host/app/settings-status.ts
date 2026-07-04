import type { PreferenceConfig } from 'loadPreference'
import { type SettingsStatus, SettingsStatusValue } from 'settings-status-model'

type SetupPreferenceConfig = Pick<PreferenceConfig, 'wifi'>

export function createInitialSettingsStatus(preferences: SetupPreferenceConfig): SettingsStatus {
  return {
    ble: SettingsStatusValue.NOT_CONNECTED,
    wifi: SettingsStatusValue.NOT_CONNECTED,
    'wifi.ssid': stringPreference(preferences.wifi.ssid),
    'wifi.password': stringPreference(preferences.wifi.password),
  }
}

function stringPreference(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
