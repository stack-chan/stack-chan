import { Gray16Mask } from 'parts/gray16-mask'
import Gray16MaskPort, { type Gray16MaskPort as Gray16MaskPortInstance } from 'parts/gray16-mask-port'
import { QuantizedMouthMaskBehavior } from 'parts/part-behavior'
import { unitFromStep } from 'parts/unit-steps'

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
