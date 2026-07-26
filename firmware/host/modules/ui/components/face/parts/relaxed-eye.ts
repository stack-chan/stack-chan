import type { FaceEyeKey } from 'face-state'
import { Gray16Mask } from 'parts/gray16-mask'
import Gray16MaskPort, { type Gray16MaskPort as Gray16MaskPortInstance } from 'parts/gray16-mask-port'
import { FacePrimaryColorBehavior } from 'parts/part-behavior'

export type RelaxedEyeOptions = { cx: number; cy: number; side: FaceEyeKey; width?: number; height?: number }

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
    Behavior: class extends FacePrimaryColorBehavior {
      onDraw(port: Gray16MaskPortInstance) {
        port.drawGray(mask, this.color)
      }
    },
  }
})
