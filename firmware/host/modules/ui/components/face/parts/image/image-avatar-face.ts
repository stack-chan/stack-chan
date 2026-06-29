import { FaceBase, type FaceBaseParams } from 'behaviors/face'
import type { FaceContext } from 'face-context'
import { getImageAvatarPack, type ImageAvatarPack, type ImageAvatarStaticSprite } from 'parts/image/image-avatar-pack'
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

type AnimatedFrame = {
  texture: string
  frameWidth: number
  frameHeight: number
  frameCount: number
  ratio: number
  x: number
  y: number
  color?: string
}

type AnimatedSpriteContentParams = SpriteContentParams & {
  resolveFrame: (pack: ImageAvatarPack, face: FaceContext) => AnimatedFrame
}

function createStaticSkin(sprite: ImageAvatarStaticSprite): PiuSkin {
  return new Skin({
    texture: { path: sprite.texture },
    width: sprite.width,
    height: sprite.height,
    ...(sprite.color === undefined ? {} : { color: sprite.color }),
  })
}

function createAnimatedSkin(frame: AnimatedFrame): PiuSkin {
  return new Skin({
    texture: { path: frame.texture },
    width: frame.frameWidth,
    height: frame.frameHeight,
    variants: frame.frameWidth,
    states: frame.frameHeight,
    ...(frame.color === undefined ? {} : { color: frame.color }),
  })
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
      onFaceContext(content: PositionedContent, face: FaceContext) {
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
  const initial = opts.resolveFrame(opts.pack, {
    emotion: 'NEUTRAL',
    mouth: { open: 0 },
    eyes: {
      left: { open: 1, gazeX: 0, gazeY: 0 },
      right: { open: 1, gazeX: 0, gazeY: 0 },
    },
    breath: 1,
    theme: { primary: '#ffffff', secondary: '#000000' },
  })
  return {
    left: initial.x,
    top: initial.y,
    width: initial.frameWidth,
    height: initial.frameHeight,
    skin: createAnimatedSkin(initial),
    variant: frameIndexForRatio(initial.ratio, initial.frameCount),
    Behavior: class extends Behavior {
      lastTexture = initial.texture
      lastVariant = -1
      onFaceContext(content: PositionedContent, face: FaceContext) {
        const frame = opts.resolveFrame(opts.pack, face)
        if (frame.texture !== this.lastTexture) {
          this.lastTexture = frame.texture
          content.coordinates = { left: frame.x, top: frame.y, width: frame.frameWidth, height: frame.frameHeight }
          content.skin = createAnimatedSkin(frame)
        }
        const variant = frameIndexForRatio(frame.ratio, frame.frameCount)
        if (variant === this.lastVariant) return
        this.lastVariant = variant
        content.variant = variant
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
        resolveFrame: (avatarPack, face) => {
          const expression = resolveExpressionName(avatarPack, face.emotion)
          const eye = avatarPack.expressions[expression].eyes.left
          return { ...eye.blinkFrames, x: eye.x, y: eye.y, color: eye.color, ratio: face.eyes.left.open }
        },
      }),
      new AnimatedSprite({
        pack,
        resolveFrame: (avatarPack, face) => {
          const expression = resolveExpressionName(avatarPack, face.emotion)
          const eye = avatarPack.expressions[expression].eyes.right
          return { ...eye.blinkFrames, x: eye.x, y: eye.y, color: eye.color, ratio: face.eyes.right.open }
        },
      }),
      new AnimatedSprite({
        pack,
        resolveFrame: (avatarPack, face) => {
          const expression = resolveExpressionName(avatarPack, face.emotion)
          const mouth = avatarPack.expressions[expression].mouth
          return { ...mouth.frames, x: mouth.x, y: mouth.y, color: mouth.color, ratio: face.mouth.open }
        },
      }),
    ],
  }
})
