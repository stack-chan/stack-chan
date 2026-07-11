/**
 * Pure validation helpers that decide whether a BLE-received preference write
 * may be applied. Kept free of Moddable dependencies so Node.js unit tests can
 * exercise the logic directly.
 */

export type PreferenceKeyList = readonly (readonly [string, string, ...unknown[]])[]

export const PreferenceWriteRejection = {
  WRITES_DISABLED: 'writes-disabled',
  UNKNOWN_PREFERENCE: 'unknown-preference',
} as const
export type PreferenceWriteRejection = (typeof PreferenceWriteRejection)[keyof typeof PreferenceWriteRejection]

export type PreferenceWriteDecision = { allowed: true } | { allowed: false; reason: PreferenceWriteRejection }

export function isAllowedPreferenceKey(allowedKeys: PreferenceKeyList, domain: string, key: string): boolean {
  return allowedKeys.some(([allowedDomain, allowedKey]) => allowedDomain === domain && allowedKey === key)
}

export function validatePreferenceWrite(options: {
  allowedKeys: PreferenceKeyList
  writesEnabled: boolean
  domain: string
  key: string
}): PreferenceWriteDecision {
  if (!options.writesEnabled) {
    return { allowed: false, reason: PreferenceWriteRejection.WRITES_DISABLED }
  }
  if (!isAllowedPreferenceKey(options.allowedKeys, options.domain, options.key)) {
    return { allowed: false, reason: PreferenceWriteRejection.UNKNOWN_PREFERENCE }
  }
  return { allowed: true }
}
