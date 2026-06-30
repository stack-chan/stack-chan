import type { FaceSkinPalette } from 'face-skin'
import { type FaceEyeKey, type FaceState, toPiuColorString } from 'face-state'
import { EYELID_SPRITE, eyeOpenToVariant, IMAGE_FACE_TEXTURE_PATHS } from 'parts/image/atlas'
import type { Content as PiuContent, Skin as PiuSkin } from 'piu/MC'

export type EyelidSpriteOptions = {
  side: FaceEyeKey
}

type PositionedContent = PiuContent & {
  left: number
  top: number
  width: number
  height: number
  variant?: number
  skin?: PiuSkin
}

function createEyelidSkin(color: number): PiuSkin {
  return new Skin({
    texture: { path: IMAGE_FACE_TEXTURE_PATHS.eyelid },
    width: EYELID_SPRITE.width,
    height: EYELID_SPRITE.height,
    variants: EYELID_SPRITE.width,
    states: EYELID_SPRITE.height,
    color: toPiuColorString(color),
  })
}

export const EyelidSprite = Content.template((opts: EyelidSpriteOptions) => {
  return {
    left: 0,
    top: 0,
    width: EYELID_SPRITE.width,
    height: EYELID_SPRITE.height,
    skin: createEyelidSkin(0x000000),
    variant: eyeOpenToVariant(1),
    Behavior: class extends Behavior {
      side = opts.side
      lastOpen = NaN
      lastThemeSecondary: number | null = null
      onFaceSkin(content: PositionedContent, palette: FaceSkinPalette) {
        if (this.lastThemeSecondary !== palette.secondaryColor) {
          this.lastThemeSecondary = palette.secondaryColor
          content.skin = createEyelidSkin(palette.secondaryColor)
        }
      }
      onFaceState(content: PositionedContent, face: FaceState) {
        const open = face.eyes[this.side].open
        if (open === this.lastOpen) return
        this.lastOpen = open
        content.variant = eyeOpenToVariant(open)
      }
    },
  }
})
