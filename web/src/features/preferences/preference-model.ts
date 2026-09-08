import {
  SETTING_KEYS,
  SETTINGS_SCHEMA,
  isSettingKey,
  type SettingKey,
} from '../../../../firmware/sdk/settings-schema'

export {
  SETTINGS_SCHEMA,
  TIMEZONE_PRESETS,
  validateSetting,
} from '../../../../firmware/sdk/settings-schema'
export const PREFERENCE_KEYS = SETTING_KEYS
export type PreferenceKey = SettingKey
export type PreferenceValues = Record<PreferenceKey, string>
export const isPreferenceKey = isSettingKey
export const DEFAULT_PREFERENCES = Object.fromEntries(
  PREFERENCE_KEYS.map((key) => [key, String(SETTINGS_SCHEMA[key].defaultValue ?? '')])
) as PreferenceValues

export function preferenceChoices(key: PreferenceKey, labels: Readonly<Record<string, string>> = {}) {
  return (SETTINGS_SCHEMA[key].choices ?? []).map((value) => ({
    value,
    label: labels[value] ?? value,
    translate: false,
  }))
}
