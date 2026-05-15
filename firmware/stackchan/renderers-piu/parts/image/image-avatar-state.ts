import type { Emotion } from 'face-context'
import type { ImageAvatarPack } from 'parts/image/image-avatar-pack'

function clamp01(value: number): number {
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

export function frameIndexForRatio(ratio: number, frameCount: number): number {
  if (frameCount <= 1) return 0
  return Math.round(clamp01(ratio) * (frameCount - 1))
}

export function resolveExpressionName(pack: ImageAvatarPack, emotion: Emotion): string {
  return pack.emotionMap?.[emotion] ?? pack.defaultExpression
}
