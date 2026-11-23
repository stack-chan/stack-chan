declare const unitBrand: unique symbol
type Brand<T, Name extends string> = T & { readonly [unitBrand]: Name }

export type Seconds = Brand<number, 'Seconds'>
export type Milliseconds = Brand<number, 'Milliseconds'>
export type Centiseconds = Brand<number, 'Centiseconds'>
export type Radians = Brand<number, 'Radians'>
export type NormalizedGain = Brand<number, 'NormalizedGain'>
export type MouthOpenRatio = Brand<number, 'MouthOpenRatio'>

export function isNonNegativeSeconds(value: number): value is Seconds {
  return Number.isFinite(value) && value >= 0
}

export function isNonNegativeMilliseconds(value: number): value is Milliseconds {
  return Number.isFinite(value) && value >= 0
}

export function isNonNegativeCentiseconds(value: number): value is Centiseconds {
  return Number.isFinite(value) && value >= 0
}

export function isRadians(value: number): value is Radians {
  return Number.isFinite(value)
}

export function isNormalizedGain(value: number): value is NormalizedGain {
  return Number.isFinite(value) && value >= 0 && value <= 1
}

export function isMouthOpenRatio(value: number): value is MouthOpenRatio {
  return Number.isFinite(value) && value >= 0 && value <= 1
}

export function seconds(value: number): Seconds {
  if (!isNonNegativeSeconds(value)) {
    throw new RangeError('Duration in seconds must be a finite number >= 0')
  }
  return value
}

export function milliseconds(value: number): Milliseconds {
  if (!isNonNegativeMilliseconds(value)) {
    throw new RangeError('Duration in milliseconds must be a finite number >= 0')
  }
  return value
}

export function radians(value: number): Radians {
  if (!isRadians(value)) {
    throw new RangeError('Angle in radians must be a finite number')
  }
  return value
}

export function normalizedGain(value: number): NormalizedGain {
  if (!isNormalizedGain(value)) {
    throw new RangeError('Gain must be a finite number between 0 and 1')
  }
  return value
}

export function mouthOpenRatio(value: number): MouthOpenRatio {
  if (!isMouthOpenRatio(value)) {
    throw new RangeError('Mouth open ratio must be a finite number between 0 and 1')
  }
  return value
}

export function clampMouthOpenRatio(value: number): MouthOpenRatio {
  const clamped = !Number.isFinite(value) || value <= 0 ? 0 : value >= 1 ? 1 : value
  if (!isMouthOpenRatio(clamped)) {
    throw new RangeError('Clamped mouth open ratio out of bounds')
  }
  return clamped
}

export function secondsToMilliseconds(duration: number): Milliseconds {
  const ms = Number.isFinite(duration) ? Math.max(0, Math.round(duration * 1000)) : 0
  if (!isNonNegativeMilliseconds(ms)) {
    throw new RangeError('Duration in milliseconds out of bounds')
  }
  return ms
}

export function secondsToCentiseconds(duration: number): Centiseconds {
  const cs = Number.isFinite(duration) ? Math.max(0, Math.round(duration * 100)) : 0
  if (!isNonNegativeCentiseconds(cs)) {
    throw new RangeError('Duration in centiseconds out of bounds')
  }
  return cs
}
