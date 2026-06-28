import type { FaceContext } from 'face-context'
import type { FaceSkinPalette } from 'face-skin'
import { gazeToOffset, IMAGE_FACE_TEXTURE_PATHS, IRIS_SPRITE } from 'parts/image/atlas'
import type { Content as PiuContent, Skin as PiuSkin } from 'piu/MC'

export type IrisSpriteOptions = {
  side: keyof FaceContext['eyes']
  left?: number
  top?: number
}

type PositionedContent = PiuContent & {
  left: number
  top: number
  width: number
  height: number
  skin?: PiuSkin
  coordinates?: {
    left?: number
    top?: number
    width?: number
    height?: number
  }
}

function createIrisSkin(color: string): PiuSkin {
  return new Skin({
    texture: { path: IMAGE_FACE_TEXTURE_PATHS.iris },
    width: IRIS_SPRITE.width,
    height: IRIS_SPRITE.height,
    color,
  })
}

export const IrisSprite = Content.template((opts: IrisSpriteOptions) => {
  const baseLeft = opts.left ?? IRIS_SPRITE.baseLeft
  const baseTop = opts.top ?? IRIS_SPRITE.baseTop
  return {
    left: baseLeft,
    top: baseTop,
    width: IRIS_SPRITE.width,
    height: IRIS_SPRITE.height,
    skin: createIrisSkin('#ffffff'),
    Behavior: class extends Behavior {
      side = opts.side
      lastThemePrimary: string | null = null
      lastOffsetX = NaN
      lastOffsetY = NaN
      onFaceSkin(content: PositionedContent, palette: FaceSkinPalette) {
        if (this.lastThemePrimary === palette.primaryColor) return
        this.lastThemePrimary = palette.primaryColor
        content.skin = createIrisSkin(palette.primaryColor)
      }
      onFaceContext(content: PositionedContent, face: FaceContext) {
        const eye = face.eyes[this.side]
        const offsetX = gazeToOffset(eye.gazeX, IRIS_SPRITE.gazePixels, IRIS_SPRITE.maxOffset)
        const offsetY = gazeToOffset(eye.gazeY, IRIS_SPRITE.gazePixels, IRIS_SPRITE.maxOffset)
        if (offsetX === this.lastOffsetX && offsetY === this.lastOffsetY) return
        this.lastOffsetX = offsetX
        this.lastOffsetY = offsetY
        content.coordinates = {
          left: baseLeft + offsetX,
          top: baseTop + offsetY,
          width: IRIS_SPRITE.width,
          height: IRIS_SPRITE.height,
        }
      }
    },
  }
})
