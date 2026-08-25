export const DEFAULT_VOLUME = 0.5
export const MIN_VOLUME_PERCENT = 0
export const MAX_VOLUME_PERCENT = 100

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function finiteVolumeNumber(value: unknown): number | undefined {
  const candidate = typeof value === 'string' && value.trim().length > 0 ? Number(value) : value
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : undefined
}

export function normalizeVolume(value: unknown, fallback = DEFAULT_VOLUME): number {
  const normalizedFallback =
    typeof fallback === 'number' && Number.isFinite(fallback) ? clamp(fallback, 0, 1) : DEFAULT_VOLUME
  const numericValue = finiteVolumeNumber(value)
  return numericValue === undefined ? normalizedFallback : clamp(numericValue, 0, 1)
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

export type VolumePreferenceResolution = Readonly<{
  volume: number
  storageValue: string
  needsWrite: boolean
}>

export function resolveVolumePreference(value: unknown, fallback = DEFAULT_VOLUME): VolumePreferenceResolution {
  const volume = canonicalizeVolume(value, fallback)
  const storageValue = String(volume)
  return {
    volume,
    storageValue,
    needsWrite: typeof value !== 'string' || storageValue !== value,
  }
}
