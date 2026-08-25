import structuredClone from 'structuredClone'
import { DOMAIN, PREF_KEYS } from 'consts'
import config from 'mc/config'
import Modules from 'modules'
import Preference from 'preference'

// biome-ignore lint/suspicious/noExplicitAny: Match the type definition of mc/config
type ConfigRecord = Record<string, any>
export type PreferenceDomain = keyof typeof DOMAIN
export type PreferenceConfig = Record<PreferenceDomain, ConfigRecord>

const LEGACY_RENDERER_DOMAIN = 'renderer'
let modConfig: ConfigRecord | undefined

export function loadModConfig(): ConfigRecord {
  if (modConfig) return modConfig
  try {
    modConfig = Modules.has('mod/config') ? (Modules.importNow('mod/config') as ConfigRecord) : {}
  } catch (error) {
    trace(
      `[preferences] mod config unavailable: ${error && typeof error === 'object' && 'message' in error ? error.message : error}\n`,
    )
    modConfig = {}
  }
  return modConfig
}

const PREFERENCE_DOMAINS: PreferenceDomain[] = [
  DOMAIN.wifi,
  DOMAIN.driver,
  DOMAIN.ui,
  DOMAIN.tts,
  DOMAIN.ai,
  DOMAIN.led,
  DOMAIN.mcp,
  DOMAIN.time,
]

export default function loadPreferences(category: PreferenceDomain): ConfigRecord {
  const mcPreference = structuredClone((config[category.toLowerCase()] ?? {}) as ConfigRecord)
  const modPreference = structuredClone((loadModConfig()[category.toLowerCase()] ?? {}) as ConfigRecord)

  const preference = { ...mcPreference, ...modPreference }
  const lockedDriverType =
    category === DOMAIN.driver && mcPreference.typeLocked === true && typeof mcPreference.type === 'string'
      ? mcPreference.type
      : undefined
  if (lockedDriverType !== undefined) {
    preference.type = lockedDriverType
    preference.typeLocked = true
  }

  const keys = PREF_KEYS.filter((s) => s[0] === category)
  for (const [domain, key, ctor] of keys) {
    const value = Preference.get(domain, key)
    if (value != null) {
      if (domain === DOMAIN.driver && key === 'type' && lockedDriverType !== undefined) {
        if (String(value) !== lockedDriverType) {
          trace(`[preferences] ignored stored driver.type=${value}; platform locks it to ${lockedDriverType}\n`)
        }
        continue
      }
      preference[key] = ctor(value)
    }
  }

  if (category === DOMAIN.ui && Preference.get(DOMAIN.ui, 'type') == null) {
    const legacyType = Preference.get(LEGACY_RENDERER_DOMAIN, 'type')
    if (legacyType != null) {
      preference.type = String(legacyType)
      // Write back to the canonical domain so legacy migration is one-shot.
      Preference.set(DOMAIN.ui, 'type', preference.type)
      trace(`[preferences] migrated ${LEGACY_RENDERER_DOMAIN}.type to ${DOMAIN.ui}.type\n`)
    }
  }

  return preference
}

export function loadPreferenceConfig(): PreferenceConfig {
  return Object.fromEntries(PREFERENCE_DOMAINS.map((domain) => [domain, loadPreferences(domain)])) as PreferenceConfig
}
