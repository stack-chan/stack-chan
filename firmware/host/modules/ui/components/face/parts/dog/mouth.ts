import { Gray16Mask } from 'parts/gray16-mask'
import Gray16MaskPort, { type Gray16MaskPort as Gray16MaskPortInstance } from 'parts/gray16-mask-port'
import { QuantizedMouthMaskBehavior } from 'parts/part-behavior'
import { unitFromStep } from 'parts/unit-steps'

export type DogMouthOptions = {
  cx: number
  cy: number
  minWidth?: number
  maxWidth?: number
  minHeight?: number
  maxHeight?: number
  /** Retained for Face Editor source compatibility; local bounds are always used. */
  canvasWidth?: number
  /** Retained for Face Editor source compatibility; local bounds are always used. */
  canvasHeight?: number
}

const STROKE = 3

export const DogMouth = Gray16MaskPort.template((opts: DogMouthOptions) => {
  const minWidth = opts.minWidth ?? 50
  const maxWidth = opts.maxWidth ?? 60
  const minHeight = opts.minHeight ?? 8
  const maxHeight = opts.maxHeight ?? 24
  const left = Math.floor(opts.cx - maxWidth / 2 - STROKE)
  const top = Math.floor(opts.cy - maxHeight / 2 - STROKE)
  const width = Math.ceil(maxWidth + STROKE * 2)
  const height = Math.ceil(maxHeight + STROKE * 2)
  const mask = new Gray16Mask(width, height)

  function updateMask(openStep: number): void {
    const open = unitFromStep(openStep)
    const mouthHeight = minHeight + (maxHeight - minHeight) * open
    const mouthWidth = minWidth + (maxWidth - minWidth) * open
    const x = opts.cx - mouthWidth / 2 - left
    const y = opts.cy - mouthHeight / 2 - top
    const centerX = opts.cx - left
    mask.clear()
    mask.strokeCubic(x, y, x, y + 20, centerX, y + 20, centerX, y, STROKE)
    mask.strokeCubic(centerX, y, centerX, y + 20, x + mouthWidth, y + 20, x + mouthWidth, y, STROKE)
    if (mouthHeight > 16) {
      mask.strokeCubic(
        x + mouthWidth / 4,
        y + 16,
        x + mouthWidth / 8,
        y + mouthHeight,
        x + (mouthWidth * 7) / 8,
        y + mouthHeight,
        x + (mouthWidth * 3) / 4,
        y + 16,
        STROKE,
      )
    }
  }

  return {
    left,
    top,
    width,
    height,
    Behavior: class extends QuantizedMouthMaskBehavior {
      protected updateMask(openStep: number): void {
        updateMask(openStep)
      }

      onDraw(port: Gray16MaskPortInstance) {
        port.drawGray(mask, this.color)
      }
    },
  }
})
