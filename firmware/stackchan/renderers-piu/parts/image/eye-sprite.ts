import type { Container as PiuContainer, Skin as PiuSkin } from 'piu/MC'
import type { FaceContext } from 'face-context'
import type { FaceSkinPalette } from 'face-skin'
import { EyelidSprite } from 'parts/image/eyelid-sprite'
import { IrisSprite } from 'parts/image/iris-sprite'
import { EYELID_SPRITE } from 'parts/image/atlas'

export type EyeSpriteOptions = {
  cx: number
  cy: number
  side: keyof FaceContext['eyes']
}

type PositionedContainer = PiuContainer & {
  skin?: PiuSkin
}

function createScleraSkin(color: string): PiuSkin {
  return new Skin({ fill: color })
}

export const EyeSprite = Container.template((opts: EyeSpriteOptions) => {
  return {
    left: opts.cx - EYELID_SPRITE.width / 2,
    top: opts.cy - EYELID_SPRITE.height / 2,
    width: EYELID_SPRITE.width,
    height: EYELID_SPRITE.height,
    clip: true,
    skin: createScleraSkin('#000000'),
    contents: [new IrisSprite({ side: opts.side }), new EyelidSprite({ side: opts.side })],
    Behavior: class extends Behavior {
      lastThemeSecondary: string | null = null
      onFaceSkin(container: PositionedContainer, palette: FaceSkinPalette) {
        if (this.lastThemeSecondary === palette.secondaryColor) return
        this.lastThemeSecondary = palette.secondaryColor
        container.skin = createScleraSkin(palette.secondaryColor)
      }
    },
  }
})
