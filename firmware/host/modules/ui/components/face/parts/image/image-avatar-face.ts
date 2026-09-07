import { FaceBase, type FaceBaseParams } from 'behaviors/face'
import type { FaceState } from 'face-state'
import { STACKCHAN_DEMO_IMAGE_AVATAR_PACK, snapshotImageAvatarPack } from 'parts/image/image-avatar-pack'
import { frameIndexForRatio, resolveExpressionName } from 'parts/image/image-avatar-state'
import type { Content as PiuContent, Skin as PiuSkin } from 'piu/MC'
import type { ImageAvatarAnimatedSprite, ImageAvatarPack, ImageAvatarStaticSprite } from 'stackchan/image-avatar'

type Sprite = ImageAvatarStaticSprite | ImageAvatarAnimatedSprite
type ImageAvatarFaceParams = FaceBaseParams & { pack?: ImageAvatarPack }
type SpriteParams = {
  pack: ImageAvatarPack
  skins: ReadonlyMap<Sprite, PiuSkin>
  resolve: (pack: ImageAvatarPack, expression: string) => Sprite
  readRatio?: (face: FaceState) => number
  initialRatio?: number
}

function frameCount(sprite: Sprite): number {
  return 'frameCount' in sprite ? sprite.frameCount : 1
}

function createSkin(sprite: Sprite): PiuSkin {
  return new Skin({
    texture: { path: sprite.texture },
    width: sprite.width,
    height: sprite.height,
    ...('frameCount' in sprite ? { variants: sprite.width, states: sprite.height } : {}),
    ...(sprite.color !== undefined ? { color: sprite.color } : {}),
  })
}

const AvatarSprite = Content.template((opts: SpriteParams) => {
  const initial = opts.resolve(opts.pack, opts.pack.defaultExpression)
  const initialVariant = frameIndexForRatio(opts.initialRatio ?? 0, frameCount(initial))
  return {
    left: initial.x,
    top: initial.y,
    width: initial.width,
    height: initial.height,
    skin: opts.skins.get(initial),
    variant: initialVariant,
    Behavior: class extends Behavior {
      lastExpression = opts.pack.defaultExpression
      frames = frameCount(initial)
      lastVariant = initialVariant

      onFaceState(content: PiuContent, face: FaceState) {
        const expression = resolveExpressionName(opts.pack, face.emotion)
        if (expression !== this.lastExpression) {
          this.lastExpression = expression
          const sprite = opts.resolve(opts.pack, expression)
          this.frames = frameCount(sprite)
          const coordinates = { left: sprite.x, top: sprite.y, width: sprite.width, height: sprite.height }
          content.coordinates = coordinates
          content.skin = opts.skins.get(sprite) ?? null
        }
        const variant = frameIndexForRatio(opts.readRatio?.(face) ?? 0, this.frames)
        if (variant === this.lastVariant) return
        this.lastVariant = variant
        content.variant = variant
      }
    },
  }
})

export const ImageAvatarFace = FaceBase.template(($: ImageAvatarFaceParams = {}) => {
  const pack = snapshotImageAvatarPack(Object.hasOwn($, 'pack') ? $.pack : STACKCHAN_DEMO_IMAGE_AVATAR_PACK)
  // Resolve every expression before replacing a live face. Missing assets must
  // fail at selection, not later inside a frame callback after setup succeeds.
  const skins = new Map<Sprite, PiuSkin>()
  for (const expression of Object.values(pack.expressions))
    for (const sprite of [
      expression.head,
      expression.hands.left,
      expression.hands.right,
      expression.eyes.left,
      expression.eyes.right,
      expression.mouth,
    ])
      skins.set(sprite, createSkin(sprite))
  const part = (resolve: SpriteParams['resolve'], readRatio?: SpriteParams['readRatio'], initialRatio = 0) =>
    new AvatarSprite({ pack, skins, resolve, readRatio, initialRatio })
  return {
    left: $.left ?? Math.round((320 - pack.width) / 2),
    top: $.top ?? Math.round((240 - pack.height) / 2),
    width: $.width ?? pack.width,
    height: $.height ?? pack.height,
    contents: [
      part((pack, expression) => pack.expressions[expression].head),
      part((pack, expression) => pack.expressions[expression].hands.left),
      part((pack, expression) => pack.expressions[expression].hands.right),
      part(
        (pack, expression) => pack.expressions[expression].eyes.left,
        (face) => face.eyes.left.open,
        1,
      ),
      part(
        (pack, expression) => pack.expressions[expression].eyes.right,
        (face) => face.eyes.right.open,
        1,
      ),
      part(
        (pack, expression) => pack.expressions[expression].mouth,
        (face) => face.mouth.open,
      ),
    ],
  }
})
