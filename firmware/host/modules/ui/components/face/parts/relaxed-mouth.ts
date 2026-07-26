import { Gray16Mask } from 'parts/gray16-mask'
import Gray16MaskPort, { type Gray16MaskPort as Gray16MaskPortInstance } from 'parts/gray16-mask-port'
import { FacePrimaryColorBehavior } from 'parts/part-behavior'

export type RelaxedMouthOptions = { cx: number; cy: number; width?: number; height?: number }

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
    Behavior: class extends FacePrimaryColorBehavior {
      onDraw(port: Gray16MaskPortInstance) {
        port.drawGray(mask, this.color)
      }
    },
  }
})
