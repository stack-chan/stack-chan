import type { FaceContext } from 'face-context'
import type { FaceSkinPalette } from 'face-skin'
import { EYELID_SPRITE, eyeOpenToVariant, IMAGE_FACE_TEXTURE_PATHS } from 'parts/image/atlas'
import type { Content as PiuContent, Skin as PiuSkin } from 'piu/MC'

export type EyelidSpriteOptions = {
  side: keyof FaceContext['eyes']
}

type PositionedContent = PiuContent & {
  left: number
  top: number
  width: number
  height: number
  variant?: number
  skin?: PiuSkin
}

function createEyelidSkin(color: string): PiuSkin {
  return new Skin({
    texture: { path: IMAGE_FACE_TEXTURE_PATHS.eyelid },
    width: EYELID_SPRITE.width,
    height: EYELID_SPRITE.height,
    variants: EYELID_SPRITE.width,
    states: EYELID_SPRITE.height,
    color,
  })
}

export const EyelidSprite = Content.template((opts: EyelidSpriteOptions) => {
  return {
    left: 0,
    top: 0,
    width: EYELID_SPRITE.width,
    height: EYELID_SPRITE.height,
    skin: createEyelidSkin('#000000'),
    variant: eyeOpenToVariant(1),
    Behavior: class extends Behavior {
      side = opts.side
      lastOpen = NaN
      lastThemeSecondary: string | null = null
      onFaceSkin(content: PositionedContent, palette: FaceSkinPalette) {
        if (this.lastThemeSecondary !== palette.secondaryColor) {
          this.lastThemeSecondary = palette.secondaryColor
          content.skin = createEyelidSkin(palette.secondaryColor)
        }
      }
      onFaceContext(content: PositionedContent, face: FaceContext) {
        const open = face.eyes[this.side].open
        if (open === this.lastOpen) return
        this.lastOpen = open
        content.variant = eyeOpenToVariant(open)
      }
    },
  }
})
