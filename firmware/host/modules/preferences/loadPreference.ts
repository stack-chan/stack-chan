import structuredClone from 'structuredClone'
import config from 'mc/config'
import Modules from 'modules'
import Preference from 'preference'
import { DOMAIN, SETTING_KEYS, type SettingDomain, type SettingsForDomain, validateSetting } from 'settings-schema'
import { type SettingsLayer, SettingsService } from 'settings-service'

type ConfigRecord = Record<string, unknown>
export type PreferenceDomain = SettingDomain
export type PreferenceConfig = { [D in SettingDomain]: SettingsForDomain<D> & ConfigRecord }
let modConfig: ConfigRecord | undefined
let settings: SettingsService | undefined

export function loadModConfig(): ConfigRecord {
  if (modConfig) return modConfig
  try {
    modConfig = Modules.has('mod/config') ? (Modules.importNow('mod/config') as ConfigRecord) : {}
  } catch {
    trace('[settings] MOD configuration could not be loaded\n')
    modConfig = {}
  }
  return modConfig
}

export function getSettingsService(): SettingsService {
  if (!settings) {
    settings = new SettingsService({
      profile: () => config as SettingsLayer,
      app: () => loadModConfig() as SettingsLayer,
      storage: {
        get: (domain, key) => Preference.get(domain, key),
        set: (domain, key, value) => Preference.set(domain, key, value as string),
        delete: (domain, key) => Preference.delete(domain, key),
      },
      onIssue: (issue) => trace(`[settings] ${issue.code} ${issue.key} (${issue.source})\n`),
    })
  }
  if (Preference.get(DOMAIN.ui, 'type') == null) {
    const legacy = Preference.get('renderer', 'type')
    if (legacy != null && validateSetting('ui.type', legacy).valid) {
      settings.write({ 'ui.type': legacy })
      trace('[preferences] migrated renderer.type to ui.type\n')
    }
  }
  return settings
}

/** Legacy host configuration retains advanced profile fields, with managed keys resolved here. */
export default function loadPreferences<D extends PreferenceDomain>(category: D): PreferenceConfig[D] {
  const profile = (config[category] ?? {}) as ConfigRecord
  const app = (loadModConfig()[category] ?? {}) as ConfigRecord
  const preference = { ...structuredClone(profile), ...structuredClone(app) }
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
