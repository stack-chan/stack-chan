import type { FaceSkinPalette } from 'face-skin'
import { type FaceState, toPiuColorString } from 'face-state'
import { IMAGE_FACE_TEXTURE_PATHS, MOUTH_SPRITE, openToVariant } from 'parts/image/atlas'
import type { Content as PiuContent, Skin as PiuSkin } from 'piu/MC'

export type MouthSpriteOptions = {
  cx: number
  cy: number
}

type PositionedContent = PiuContent & {
  left: number
  top: number
  width: number
  height: number
  variant?: number
  skin?: PiuSkin
}

function createMouthSkin(color: number): PiuSkin {
  return new Skin({
    texture: { path: IMAGE_FACE_TEXTURE_PATHS.mouth },
    width: MOUTH_SPRITE.width,
    height: MOUTH_SPRITE.height,
    variants: MOUTH_SPRITE.width,
    states: MOUTH_SPRITE.height,
    color: toPiuColorString(color),
  })
}

export const MouthSprite = Content.template((opts: MouthSpriteOptions) => {
  return {
    left: opts.cx - MOUTH_SPRITE.width / 2,
    top: opts.cy - MOUTH_SPRITE.height / 2,
    width: MOUTH_SPRITE.width,
    height: MOUTH_SPRITE.height,
    skin: createMouthSkin(0xffffff),
    variant: 0,
    Behavior: class extends Behavior {
      lastOpen = NaN
      lastThemePrimary: number | null = null
      onFaceSkin(content: PositionedContent, palette: FaceSkinPalette) {
        if (this.lastThemePrimary !== palette.primaryColor) {
          this.lastThemePrimary = palette.primaryColor
          content.skin = createMouthSkin(palette.primaryColor)
        }
      }
      onFaceState(content: PositionedContent, face: FaceState) {
        const open = face.mouth.open
        if (open === this.lastOpen) return
        this.lastOpen = open
        content.variant = openToVariant(open, MOUTH_SPRITE.frameCount)
      }
    },
  }
})
