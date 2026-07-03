export const UNIT_OPEN_STEPS = 12
export const SHAPE_CACHE_ENTRY_LIMIT = 128

export function quantizeUnit(value: number, steps = UNIT_OPEN_STEPS): number {
  if (!Number.isFinite(value)) return 0
  if (value <= 0) return 0
  if (value >= 1) return steps
  return Math.round(value * steps)
}

export function unitFromStep(step: number, steps = UNIT_OPEN_STEPS): number {
  if (step <= 0) return 0
  if (step >= steps) return 1
  return step / steps
}

export function rememberCachedValue<K, V>(cache: Map<K, V>, key: K, value: V, limit = SHAPE_CACHE_ENTRY_LIMIT): V {
  if (cache.size >= limit) {
    const oldest = cache.keys().next()
    if (!oldest.done) {
      cache.delete(oldest.value)
    }
  }
  cache.set(key, value)
  return value
}
