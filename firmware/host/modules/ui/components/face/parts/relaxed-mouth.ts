import type { FaceSkinPalette } from 'face-skin'
import { DEFAULT_FACE_PRIMARY_COLOR, type FaceState, toPiuColorNumber } from 'face-state'
import { Gray16Mask } from 'parts/gray16-mask'
import Gray16MaskPort from 'parts/gray16-mask-port'
import type { Port as PiuPort } from 'piu/MC'

export type RelaxedMouthOptions = { cx: number; cy: number; width?: number; height?: number }

type MaskPort = PiuPort & {
  drawGray: (mask: Gray16Mask, color: number) => void
}

export const RelaxedMouth = Gray16MaskPort.template((options: RelaxedMouthOptions) => {
  const width = options.width ?? 34
  const height = options.height ?? 15
  const mask = new Gray16Mask(width, height)
  mask.strokeQuadratic(1, height - 2, width / 2, 1, width - 1, height - 2, 4)

  return {
    left: options.cx - width / 2,
    top: options.cy - height / 2,
    width,
    height,
    Behavior: class extends Behavior {
      #hasPalette = false
      #primary = DEFAULT_FACE_PRIMARY_COLOR

      onFaceSkin(port: PiuPort, palette: FaceSkinPalette) {
        this.#hasPalette = true
        if (this.#primary === palette.primaryColor) return
        this.#primary = palette.primaryColor
        port.invalidate()
      }

      onFaceState(port: PiuPort, face: FaceState) {
        if (this.#hasPalette) return
        const primary = toPiuColorNumber(face.theme.primary)
        if (primary === this.#primary) return
        this.#primary = primary
        port.invalidate()
      }

      onDraw(port: MaskPort) {
        port.drawGray(mask, this.#primary)
      }
    },
  }
})
