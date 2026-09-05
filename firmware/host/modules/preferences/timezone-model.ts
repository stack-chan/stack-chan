import { DEFAULT_TIMEZONE_ID, TIMEZONE_PRESETS, type TimezoneId, type TimezonePreset } from 'settings-schema'

export { DEFAULT_TIMEZONE_ID, TIMEZONE_PRESETS, type TimezoneId, type TimezonePreset } from 'settings-schema'

export function normalizeTimezoneId(value: unknown): TimezoneId {
  if (typeof value !== 'string') return DEFAULT_TIMEZONE_ID
  for (const preset of TIMEZONE_PRESETS) {
    if (preset.id === value) return preset.id
  }
  return DEFAULT_TIMEZONE_ID
}

export function getTimezonePreset(value: unknown): TimezonePreset {
  const id = normalizeTimezoneId(value)
  for (const preset of TIMEZONE_PRESETS) {
    if (preset.id === id) return preset
  }
  for (const preset of TIMEZONE_PRESETS) {
    if (preset.id === DEFAULT_TIMEZONE_ID) return preset
  }
  throw new Error(`Missing default time zone preset: ${DEFAULT_TIMEZONE_ID}`)
}

export function formatUtcOffset(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? '-' : '+'
  const absoluteMinutes = Math.abs(offsetMinutes)
  const hours = Math.floor(absoluteMinutes / 60)
  const minutes = absoluteMinutes % 60
  return `UTC${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}
