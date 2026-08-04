export const SPRITE_PULSE_FRAME_COUNT = 4

export function packedSpriteColor(color: number, alpha = 0xff): number {
  return ((color << 8) | alpha) >>> 0
}

export function spritePulseVariantForFraction(fraction: number): number {
  const pulse = (Math.sin(fraction) + 1) / 2
  const variant = Math.round(pulse * (SPRITE_PULSE_FRAME_COUNT - 1))
  if (variant < 0) return 0
  if (variant >= SPRITE_PULSE_FRAME_COUNT) return SPRITE_PULSE_FRAME_COUNT - 1
  return variant
}
