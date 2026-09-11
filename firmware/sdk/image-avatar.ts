import type { Emotion } from 'stackchan/app'

export type ImageAvatarStaticSprite = Readonly<{
  texture: string
  color?: string
  x: number
  y: number
  width: number
  height: number
}>
/** Horizontal PNG strip; width and height describe one frame. */
export type ImageAvatarAnimatedSprite = ImageAvatarStaticSprite & Readonly<{ frameCount: number }>
export type ImageAvatarExpression = Readonly<{
  head: ImageAvatarStaticSprite
  eyes: Readonly<{ left: ImageAvatarAnimatedSprite; right: ImageAvatarAnimatedSprite }>
  mouth: ImageAvatarAnimatedSprite
  hands: Readonly<{ left: ImageAvatarStaticSprite; right: ImageAvatarStaticSprite }>
}>

/** PNG resources belong to the app archive. emotionMap uses the same emotion names as app.face. */
export type ImageAvatarPack = Readonly<{
  id: string
  displayName: string
  width: number
  height: number
  defaultExpression: string
  emotionMap: Readonly<Partial<Record<Emotion, string>>>
  expressions: Readonly<Record<string, ImageAvatarExpression>>
}>
