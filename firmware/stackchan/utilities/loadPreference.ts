import { type DOMAIN, PREF_KEYS } from 'consts'
import Preference from 'preference'
import structuredClone from 'structuredClone'
import config from 'mc/config'
import Modules from 'modules'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

const importedModConfig = Modules.has('mod/config') ? Modules.importNow('mod/config') : undefined
const modConfig: Record<string, unknown> = isRecord(importedModConfig) ? importedModConfig : {}

export default function loadPreferences(category: keyof typeof DOMAIN) {
  const mcConfigValue = config[category.toLowerCase()]
  const modConfigValue = modConfig[category.toLowerCase()]
  const mcPreference = structuredClone(isRecord(mcConfigValue) ? mcConfigValue : {})
  const modPreference = structuredClone(isRecord(modConfigValue) ? modConfigValue : {})

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
