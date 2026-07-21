import { FaceBase, type FaceBaseParams } from 'behaviors/face'
import type { FaceState } from 'face-state'
import {
  getImageAvatarPack,
  type ImageAvatarEyeSprite,
  type ImageAvatarMouthSprite,
  type ImageAvatarPack,
  type ImageAvatarSpriteSheet,
  type ImageAvatarStaticSprite,
} from 'parts/image/image-avatar-pack'
import { frameIndexForRatio, resolveExpressionName } from 'parts/image/image-avatar-state'
import type { Content as PiuContent, Skin as PiuSkin } from 'piu/MC'

type PositionedContent = PiuContent & {
  variant?: number
  skin?: PiuSkin
  coordinates?: {
    left?: number
    top?: number
    width?: number
    height?: number
  }
}

type ImageAvatarFaceParams = FaceBaseParams & {
  pack?: ImageAvatarPack | string
}

type SpriteContentParams = {
  pack: ImageAvatarPack
}

type ExpressionSpriteContentParams = SpriteContentParams & {
  resolveSprite: (pack: ImageAvatarPack, expression: string) => ImageAvatarStaticSprite
}

type AnimatedSpriteSource = ImageAvatarEyeSprite | ImageAvatarMouthSprite

type AnimatedSpriteContentParams = SpriteContentParams & {
  resolveSource: (pack: ImageAvatarPack, expression: string) => AnimatedSpriteSource
  resolveFrames: (source: AnimatedSpriteSource) => ImageAvatarSpriteSheet
  readRatio: (face: FaceState) => number
  initialRatio: number
}

function createStaticSkin(sprite: ImageAvatarStaticSprite): PiuSkin {
  const dictionary: { texture: { path: string }; width: number; height: number; color?: string } = {
    texture: { path: sprite.texture },
    width: sprite.width,
    height: sprite.height,
  }
  if (sprite.color !== undefined) dictionary.color = sprite.color
  return new Skin(dictionary)
}

function createAnimatedSkin(source: AnimatedSpriteSource, frames: ImageAvatarSpriteSheet): PiuSkin {
  const dictionary: {
    texture: { path: string }
    width: number
    height: number
    variants: number
    states: number
    color?: string
  } = {
    texture: { path: frames.texture },
    width: frames.frameWidth,
    height: frames.frameHeight,
    variants: frames.frameWidth,
    states: frames.frameHeight,
  }
  if (source.color !== undefined) dictionary.color = source.color
  return new Skin(dictionary)
}

const ExpressionSprite = Content.template((opts: ExpressionSpriteContentParams) => {
  const initial = opts.resolveSprite(opts.pack, opts.pack.defaultExpression)
  return {
    left: initial.x,
    top: initial.y,
    width: initial.width,
    height: initial.height,
    skin: createStaticSkin(initial),
    Behavior: class extends Behavior {
      lastExpression = opts.pack.defaultExpression
      onFaceState(content: PositionedContent, face: FaceState) {
        const expression = resolveExpressionName(opts.pack, face.emotion)
        if (expression === this.lastExpression) return
        this.lastExpression = expression
        const sprite = opts.resolveSprite(opts.pack, expression)
        content.coordinates = { left: sprite.x, top: sprite.y, width: sprite.width, height: sprite.height }
        content.skin = createStaticSkin(sprite)
      }
    },
  }
})

const AnimatedSprite = Content.template((opts: AnimatedSpriteContentParams) => {
  const initialExpression = opts.pack.defaultExpression
  const initialSource = opts.resolveSource(opts.pack, initialExpression)
  const initialFrames = opts.resolveFrames(initialSource)
  const initialVariant = frameIndexForRatio(opts.initialRatio, initialFrames.frameCount)
  return {
    left: initialSource.x,
    top: initialSource.y,
    width: initialFrames.frameWidth,
    height: initialFrames.frameHeight,
    skin: createAnimatedSkin(initialSource, initialFrames),
    variant: initialVariant,
    Behavior: class extends Behavior {
      lastColor = initialSource.color
      lastExpression = initialExpression
      lastFrameCount = initialFrames.frameCount
      lastFrameHeight = initialFrames.frameHeight
      lastFrameWidth = initialFrames.frameWidth
      lastTexture = initialFrames.texture
      lastVariant = initialVariant
      lastX = initialSource.x
      lastY = initialSource.y

      onFaceState(content: PositionedContent, face: FaceState) {
        const expression = resolveExpressionName(opts.pack, face.emotion)
        if (expression !== this.lastExpression) {
          this.lastExpression = expression
          const source = opts.resolveSource(opts.pack, expression)
          const frames = opts.resolveFrames(source)
          this.updateSource(content, source, frames)
        }
        const variant = frameIndexForRatio(opts.readRatio(face), this.lastFrameCount)
        if (variant === this.lastVariant) return
        this.lastVariant = variant
        content.variant = variant
      }

      updateSource(content: PositionedContent, source: AnimatedSpriteSource, frames: ImageAvatarSpriteSheet) {
        const geometryChanged =
          source.x !== this.lastX ||
          source.y !== this.lastY ||
          frames.frameWidth !== this.lastFrameWidth ||
          frames.frameHeight !== this.lastFrameHeight
        const skinChanged =
          frames.texture !== this.lastTexture ||
          source.color !== this.lastColor ||
          frames.frameWidth !== this.lastFrameWidth ||
          frames.frameHeight !== this.lastFrameHeight

        this.lastColor = source.color
        this.lastFrameCount = frames.frameCount
        this.lastFrameHeight = frames.frameHeight
        this.lastFrameWidth = frames.frameWidth
        this.lastTexture = frames.texture
        this.lastX = source.x
        this.lastY = source.y

        if (geometryChanged) {
          content.coordinates = { left: source.x, top: source.y, width: frames.frameWidth, height: frames.frameHeight }
        }
        if (skinChanged) {
          content.skin = createAnimatedSkin(source, frames)
        }
      }
    },
  }
})

function resolvePack(pack: ImageAvatarPack | string | undefined): ImageAvatarPack {
  if (typeof pack === 'string') return getImageAvatarPack(pack)
  if (pack === undefined) return getImageAvatarPack(undefined)
  return pack
}

export const ImageAvatarFace = FaceBase.template(($: ImageAvatarFaceParams = {}) => {
  const pack = resolvePack($.pack)
  return {
    left: $.left ?? Math.round((320 - pack.width) / 2),
    top: $.top ?? Math.round((240 - pack.height) / 2),
    width: $.width ?? pack.width,
    height: $.height ?? pack.height,
    contents: [
      new ExpressionSprite({
        pack,
        resolveSprite: (avatarPack, expression) => avatarPack.expressions[expression].head,
      }),
      new ExpressionSprite({
        pack,
        resolveSprite: (avatarPack, expression) => avatarPack.expressions[expression].hands.left,
      }),
      new ExpressionSprite({
        pack,
        resolveSprite: (avatarPack, expression) => avatarPack.expressions[expression].hands.right,
      }),
      new AnimatedSprite({
        pack,
        resolveSource: (avatarPack, expression) => avatarPack.expressions[expression].eyes.left,
        resolveFrames: (source) => (source as ImageAvatarEyeSprite).blinkFrames,
        readRatio: (face) => face.eyes.left.open,
        initialRatio: 1,
      }),
      new AnimatedSprite({
        pack,
        resolveSource: (avatarPack, expression) => avatarPack.expressions[expression].eyes.right,
        resolveFrames: (source) => (source as ImageAvatarEyeSprite).blinkFrames,
        readRatio: (face) => face.eyes.right.open,
        initialRatio: 1,
      }),
      new AnimatedSprite({
        pack,
        resolveSource: (avatarPack, expression) => avatarPack.expressions[expression].mouth,
        resolveFrames: (source) => (source as ImageAvatarMouthSprite).frames,
        readRatio: (face) => face.mouth.open,
        initialRatio: 0,
      }),
    ],
  }
})
