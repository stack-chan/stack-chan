import type { FaceSkinPalette } from 'face-skin'
import { type FaceEyeKey, toPiuColorString } from 'face-state'
import { EYELID_SPRITE } from 'parts/image/atlas'
import { EyelidSprite } from 'parts/image/eyelid-sprite'
import { IrisSprite } from 'parts/image/iris-sprite'
import type { Container as PiuContainer, Skin as PiuSkin } from 'piu/MC'

export type EyeSpriteOptions = {
  cx: number
  cy: number
  side: FaceEyeKey
}

type PositionedContainer = PiuContainer & {
  skin?: PiuSkin
}

function createScleraSkin(color: number): PiuSkin {
  return new Skin({ fill: toPiuColorString(color) })
}

export const EyeSprite = Container.template((opts: EyeSpriteOptions) => {
  return {
    left: opts.cx - EYELID_SPRITE.width / 2,
    top: opts.cy - EYELID_SPRITE.height / 2,
    width: EYELID_SPRITE.width,
    height: EYELID_SPRITE.height,
    clip: true,
    skin: createScleraSkin(0x000000),
    contents: [new IrisSprite({ side: opts.side }), new EyelidSprite({ side: opts.side })],
    Behavior: class extends Behavior {
      lastThemeSecondary: number | null = null
      onFaceSkin(container: PositionedContainer, palette: FaceSkinPalette) {
        if (this.lastThemeSecondary === palette.secondaryColor) return
        this.lastThemeSecondary = palette.secondaryColor
        container.skin = createScleraSkin(palette.secondaryColor)
      }
    },
  }
})
