export type TimezoneId =
  | 'honolulu'
  | 'los-angeles'
  | 'denver'
  | 'chicago'
  | 'new-york'
  | 'sao-paulo'
  | 'london'
  | 'paris'
  | 'cairo'
  | 'moscow'
  | 'dubai'
  | 'delhi'
  | 'bangkok'
  | 'beijing'
  | 'tokyo'
  | 'sydney'
  | 'auckland'

export type TimezonePreset = Readonly<{
  id: TimezoneId
  labelKey: string
  offsetMinutes: number
}>

export const DEFAULT_TIMEZONE_ID: TimezoneId = 'tokyo'

export const TIMEZONE_PRESETS: readonly TimezonePreset[] = Object.freeze([
  { id: 'honolulu', labelKey: 'timezone.city.honolulu', offsetMinutes: -10 * 60 },
  { id: 'los-angeles', labelKey: 'timezone.city.losAngeles', offsetMinutes: -8 * 60 },
  { id: 'denver', labelKey: 'timezone.city.denver', offsetMinutes: -7 * 60 },
  { id: 'chicago', labelKey: 'timezone.city.chicago', offsetMinutes: -6 * 60 },
  { id: 'new-york', labelKey: 'timezone.city.newYork', offsetMinutes: -5 * 60 },
  { id: 'sao-paulo', labelKey: 'timezone.city.saoPaulo', offsetMinutes: -3 * 60 },
  { id: 'london', labelKey: 'timezone.city.london', offsetMinutes: 0 },
  { id: 'paris', labelKey: 'timezone.city.paris', offsetMinutes: 1 * 60 },
  { id: 'cairo', labelKey: 'timezone.city.cairo', offsetMinutes: 2 * 60 },
  { id: 'moscow', labelKey: 'timezone.city.moscow', offsetMinutes: 3 * 60 },
  { id: 'dubai', labelKey: 'timezone.city.dubai', offsetMinutes: 4 * 60 },
  { id: 'delhi', labelKey: 'timezone.city.delhi', offsetMinutes: 5 * 60 + 30 },
  { id: 'bangkok', labelKey: 'timezone.city.bangkok', offsetMinutes: 7 * 60 },
  { id: 'beijing', labelKey: 'timezone.city.beijing', offsetMinutes: 8 * 60 },
  { id: 'tokyo', labelKey: 'timezone.city.tokyo', offsetMinutes: 9 * 60 },
  { id: 'sydney', labelKey: 'timezone.city.sydney', offsetMinutes: 10 * 60 },
  { id: 'auckland', labelKey: 'timezone.city.auckland', offsetMinutes: 12 * 60 },
])

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
