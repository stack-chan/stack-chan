import structuredClone from 'structuredClone'
import verifyInstalledMod from 'installed-mod'
import config from 'mc/config'
import Preference from 'preference'
import { SETTINGS_JOURNAL, type SettingsLayer, SettingsService } from 'settings-service'
import { StackchanError } from 'stackchan/errors'
import {
  DOMAIN,
  isSettingKey,
  SETTING_KEYS,
  SETTINGS_SCHEMA,
  type SettingDomain,
  type SettingsForDomain,
  validateSetting,
} from 'stackchan/settings-schema'

type ConfigRecord = Record<string, unknown>
export type PreferenceDomain = SettingDomain
export type PreferenceConfig = { [D in SettingDomain]: SettingsForDomain<D> & ConfigRecord }
let appSettings: SettingsLayer | undefined
let settings: SettingsService | undefined
let hostSettings: SettingsService | undefined

function loadAppSettings(): SettingsLayer {
  if (appSettings) return appSettings
  const contract = verifyInstalledMod()
  if (!contract) return {}
  const result: SettingsLayer = {}
  for (const [key, input] of Object.entries(contract.settings)) {
    if (!isSettingKey(key) || !SETTINGS_SCHEMA[key].appDefault)
      throw new StackchanError('CONFIG', `MOD setting ${key} is unavailable for app defaults`)
    const validated = validateSetting(key, input)
    if (validated.valid === false) throw new StackchanError('CONFIG', `MOD setting ${key} is invalid`)
    const [domain, name] = key.split('.') as [SettingDomain, string]
    result[domain] = { ...result[domain], [name]: validated.value }
  }
  appSettings = result
  return result
}

function createSettingsService(app: () => SettingsLayer): SettingsService {
  return new SettingsService({
    profile: () => config as SettingsLayer,
    app,
    storage: {
      get: (domain, key) => {
        const value = Preference.get(domain, key)
        return domain === SETTINGS_JOURNAL.domain && key === SETTINGS_JOURNAL.key && value instanceof ArrayBuffer
          ? String.fromArrayBuffer(value)
          : value
      },
      set: (domain, key, value) =>
        Preference.set(
          domain,
          key,
          domain === SETTINGS_JOURNAL.domain && key === SETTINGS_JOURNAL.key
            ? ArrayBuffer.fromString(value as string)
            : (value as string),
        ),
      delete: (domain, key) => Preference.delete(domain, key),
    },
    onIssue: (issue) => trace(`[settings] ${issue.code} ${issue.key} (${issue.source})\n`),
  })
}

/** Recovery must be able to read host settings without evaluating a rejected MOD. */
export function getHostSettingsService(): SettingsService {
  hostSettings ??= createSettingsService(() => ({}))
  return hostSettings
}

export function getSettingsService(): SettingsService {
  settings ??= createSettingsService(loadAppSettings)
  return settings
}

/** Hardware profile fields stay host-owned; app defaults use only the managed settings schema. */
export default function loadPreferences<D extends PreferenceDomain>(category: D): PreferenceConfig[D] {
  const profile = (config[category] ?? {}) as ConfigRecord
  const preference = { ...structuredClone(profile) }
  const service = getSettingsService()
  for (const key of SETTING_KEYS) {
    const [domain, name] = key.split('.')
    if (domain !== category) continue
    const value = service.get(key)
    if (value === undefined) delete preference[name]
    else preference[name] = value
  }
  if (category === DOMAIN.driver) preference.typeLocked = service.isReadOnly('driver.type')
  return preference as PreferenceConfig[D]
}

export function loadPreferenceConfig(): PreferenceConfig {
  return Object.fromEntries(
    (Object.keys(DOMAIN) as SettingDomain[]).map((domain) => [domain, loadPreferences(domain)]),
  ) as PreferenceConfig
}
