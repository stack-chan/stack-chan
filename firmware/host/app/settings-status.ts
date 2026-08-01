import type { PreferenceConfig } from 'loadPreference'
import { type SettingsStatus, SettingsStatusValue } from 'settings-status-model'
import { canonicalizeVolume } from 'volume-model'

type SetupPreferenceConfig = Pick<PreferenceConfig, 'wifi'> & Partial<Pick<PreferenceConfig, 'time' | 'tts' | 'ui'>>

export function createInitialSettingsStatus(preferences: SetupPreferenceConfig): SettingsStatus {
  return {
    ble: SettingsStatusValue.NOT_CONNECTED,
    wifi: SettingsStatusValue.NOT_CONNECTED,
    'wifi.ssid': stringPreference(preferences.wifi.ssid),
    'wifi.password': stringPreference(preferences.wifi.password),
    'ui.language': stringPreference(preferences.ui?.language),
    'time.timezone': stringPreference(preferences.time?.timezone),
    'tts.volume': canonicalizeVolume(preferences.tts?.volume),
  }
}

function stringPreference(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
