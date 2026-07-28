import Time from 'time'
import { getTimezonePreset, type TimezoneId } from 'timezone-model'

export {
  DEFAULT_TIMEZONE_ID,
  TIMEZONE_PRESETS,
  formatUtcOffset,
  getTimezonePreset,
  normalizeTimezoneId,
} from 'timezone-model'
export type { TimezoneId, TimezonePreset } from 'timezone-model'

export function applyTimezone(value: unknown): TimezoneId {
  const preset = getTimezonePreset(value)
  Time.timezone = preset.offsetMinutes * 60
  Time.dst = 0
  return preset.id
}
