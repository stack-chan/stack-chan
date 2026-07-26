import type { FaceSkinPalette } from 'face-skin'
import { DEFAULT_FACE_PRIMARY_COLOR, type FaceState, toPiuColorNumber } from 'face-state'
import { Gray16Mask } from 'parts/gray16-mask'
import Gray16MaskPort from 'parts/gray16-mask-port'
import { quantizeUnit, unitFromStep } from 'parts/shape-utils'
import type { Port as PiuPort } from 'piu/MC'

export type DogNoseOptions = {
  cx: number
  cy: number
  minHeight?: number
  maxHeight?: number
  /** Retained for Face Editor source compatibility; local bounds are always used. */
  canvasWidth?: number
  /** Retained for Face Editor source compatibility; local bounds are always used. */
  canvasHeight?: number
}

type MaskPort = PiuPort & {
  drawGray: (mask: Gray16Mask, color: number) => void
}

export const DogNose = Gray16MaskPort.template((opts: DogNoseOptions) => {
  const minHeight = opts.minHeight ?? 8
  const maxHeight = opts.maxHeight ?? 24
  const left = Math.floor(opts.cx - 10)
  const top = Math.floor(opts.cy - maxHeight / 2 - 20)
  const width = 20
  const height = Math.ceil((maxHeight - minHeight) / 2 + 18)
  const mask = new Gray16Mask(width, height)

  function updateMask(openStep: number): void {
    const open = unitFromStep(openStep)
    const mouthHeight = minHeight + (maxHeight - minHeight) * open
    const y = opts.cy - mouthHeight / 2 - top
    const centerX = opts.cx - left
    mask.clear()
    mask.fillTriangle(centerX - 8, y - 16, centerX + 8, y - 16, centerX, y - 4)
    mask.fillRotatedEllipse(centerX, y - 15.5, 8, 2.5, 0)
  }

  return {
    left,
    top,
    width,
    height,
    Behavior: class extends Behavior {
      #lastOpenStep = -1
      #palette: FaceSkinPalette | null = null
      #primary = DEFAULT_FACE_PRIMARY_COLOR
      revision = 0

      onCreate(port: PiuPort) {
        this.update(port, quantizeUnit(0))
      }

      onFaceSkin(port: PiuPort, palette: FaceSkinPalette) {
        this.#palette = palette
        if (this.#primary === palette.primaryColor) return
        this.#primary = palette.primaryColor
        port.invalidate()
      }

      onFaceState(port: PiuPort, face: FaceState) {
        if (!this.#palette) {
          const primary = toPiuColorNumber(face.theme.primary)
          if (primary !== this.#primary) {
            this.#primary = primary
            port.invalidate()
          }
        }
        this.update(port, quantizeUnit(face.mouth.open))
      }

      update(port: PiuPort, openStep: number) {
        if (openStep === this.#lastOpenStep) return
        this.#lastOpenStep = openStep
        updateMask(openStep)
        this.revision++
        port.invalidate()
      }

      onDraw(port: MaskPort) {
        port.drawGray(mask, this.#primary)
      }
    },
  }
})
