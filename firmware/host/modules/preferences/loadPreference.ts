import structuredClone from 'structuredClone'
import { DOMAIN, PREF_KEYS } from 'consts'
import config from 'mc/config'
import Modules from 'modules'
import Preference from 'preference'

// biome-ignore lint/suspicious/noExplicitAny: Match the type definition of mc/config
type ConfigRecord = Record<string, any>
export type PreferenceDomain = keyof typeof DOMAIN
export type PreferenceConfig = Record<PreferenceDomain, ConfigRecord>

const modConfig: ConfigRecord = Modules.has('mod/config') ? (Modules.importNow('mod/config') as ConfigRecord) : {}

const PREFERENCE_DOMAINS: PreferenceDomain[] = [
  DOMAIN.wifi,
  DOMAIN.driver,
  DOMAIN.ui,
  DOMAIN.tts,
  DOMAIN.ai,
  DOMAIN.led,
]

export default function loadPreferences(category: PreferenceDomain): ConfigRecord {
  const mcPreference = structuredClone(config[category.toLowerCase()] ?? {})
  const modPreference = structuredClone(modConfig[category.toLowerCase()] ?? {})

  const preference = { ...mcPreference, ...modPreference }

  const keys = PREF_KEYS.filter((s) => s[0] === category)
  for (const [domain, key, ctor] of keys) {
    const value = Preference.get(domain, key)
    if (value != null) {
      preference[key] = ctor(value)
    }
  }

  return preference
}

export function loadPreferenceConfig(): PreferenceConfig {
  return Object.fromEntries(PREFERENCE_DOMAINS.map((domain) => [domain, loadPreferences(domain)])) as PreferenceConfig
}
