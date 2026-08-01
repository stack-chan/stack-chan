export const DEFAULT_VOLUME = 0.5
export const MIN_VOLUME_PERCENT = 0
export const MAX_VOLUME_PERCENT = 100
const VOLUME_PREFERENCE_PREFIX = 'percent:'

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

export function normalizeVolume(value: unknown, fallback = DEFAULT_VOLUME): number {
  const normalizedFallback =
    typeof fallback === 'number' && Number.isFinite(fallback) ? clamp(fallback, 0, 1) : DEFAULT_VOLUME
  if (typeof value !== 'number' || !Number.isFinite(value)) return normalizedFallback
  return clamp(value, 0, 1)
}

export function volumeToPercent(value: unknown, fallback = DEFAULT_VOLUME): number {
  return Math.round(normalizeVolume(value, fallback) * MAX_VOLUME_PERCENT)
}

export function volumePercentToValue(percent: unknown, fallback = DEFAULT_VOLUME): number {
  if (typeof percent !== 'number' || !Number.isFinite(percent)) {
    return Math.round(normalizeVolume(fallback) * MAX_VOLUME_PERCENT) / MAX_VOLUME_PERCENT
  }
  return clamp(Math.round(percent), MIN_VOLUME_PERCENT, MAX_VOLUME_PERCENT) / MAX_VOLUME_PERCENT
}

export function canonicalizeVolume(value: unknown, fallback = DEFAULT_VOLUME): number {
  return volumePercentToValue(volumeToPercent(value, fallback), fallback)
}

export function encodeVolumePreference(value: unknown, fallback = DEFAULT_VOLUME): string {
  return `${VOLUME_PREFERENCE_PREFIX}${volumeToPercent(value, fallback)}`
}

export function decodeVolumePreference(value: unknown, fallback = DEFAULT_VOLUME): number {
  if (typeof value === 'string' && value.startsWith(VOLUME_PREFERENCE_PREFIX)) {
    const percent = Number(value.slice(VOLUME_PREFERENCE_PREFIX.length))
    if (Number.isSafeInteger(percent) && percent >= MIN_VOLUME_PERCENT && percent <= MAX_VOLUME_PERCENT) {
      return volumePercentToValue(percent, fallback)
    }
  }
  return canonicalizeVolume(value, fallback)
}
