import type { FaceSkinPalette } from 'face-skin'
import { DEFAULT_FACE_PRIMARY_COLOR, type FaceEyeKey, type FaceState, toPiuColorNumber } from 'face-state'
import { Gray16Mask } from 'parts/gray16-mask'
import Gray16MaskPort from 'parts/gray16-mask-port'
import type { Port as PiuPort } from 'piu/MC'

export type RelaxedEyeOptions = { cx: number; cy: number; side: FaceEyeKey; width?: number; height?: number }

type MaskPort = PiuPort & {
  drawGray: (mask: Gray16Mask, color: number) => void
}

export const RelaxedEye = Gray16MaskPort.template((options: RelaxedEyeOptions) => {
  const width = options.width ?? 42
  const height = options.height ?? 18
  const mask = new Gray16Mask(width, height)
  const y = options.side === 'left' ? 2 : 3
  mask.strokeQuadratic(1, y, width / 2, height, width - 1, y, 5)

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
