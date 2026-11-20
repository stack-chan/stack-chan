export type PreferenceKeyList = readonly (readonly [string, string, ...unknown[]])[]

export const BLE_PREFERENCE_WRITE_WINDOW_MS = 5 * 60 * 1000

export function parsePreferenceProperty(prop: unknown): { domain: string; key: string } | undefined {
  if (typeof prop !== 'string') return
  const parts = prop.split('.')
  if (parts.length !== 2 || parts[0].length === 0 || parts[1].length === 0) return
  return { domain: parts[0], key: parts[1] }
}

export function isAllowedPreferenceWrite(
  allowedKeys: PreferenceKeyList,
  writesEnabled: boolean,
  domain: string,
  key: string,
): boolean {
  return (
    writesEnabled && allowedKeys.some(([allowedDomain, allowedKey]) => allowedDomain === domain && allowedKey === key)
  )
}
