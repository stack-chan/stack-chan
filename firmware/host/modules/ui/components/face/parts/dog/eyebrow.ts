import { Emotion, emotionWeight, type FaceEyeKey, type FaceState } from 'face-state'
import { Gray16Mask } from 'parts/gray16-mask'
import Gray16MaskPort, { type Gray16MaskPort as Gray16MaskPortInstance } from 'parts/gray16-mask-port'
import { FacePrimaryColorBehavior } from 'parts/part-behavior'
import type { Port as PiuPort } from 'piu/MC'

export type EyebrowOptions = {
  cx: number
  cy: number
  side: FaceEyeKey
  /** Retained for Face Editor source compatibility; local bounds are always used. */
  canvasWidth?: number
  /** Retained for Face Editor source compatibility; local bounds are always used. */
  canvasHeight?: number
}

function quantize(value: number): number {
  return Math.round(value * 64) / 64
}

export const DogEyebrow = Gray16MaskPort.template((opts: EyebrowOptions) => {
  const direction = opts.side === 'left' ? 1 : -1
  const centerX = opts.cx + 8 * direction
  const left = Math.floor(centerX - 16)
  const top = Math.floor(opts.cy - 33)
  const width = 32
  const height = 24
  const mask = new Gray16Mask(width, height)

  return {
    left,
    top,
    width,
    height,
    Behavior: class extends FacePrimaryColorBehavior {
      #centerY = NaN
      #rotation = NaN
      revision = 0

      onCreate(port: PiuPort) {
        port.invalidate()
      }

      override onFaceState(port: PiuPort, face: FaceState) {
        super.onFaceState(port, face)
        const open = Math.max(0, Math.min(1, face.eyes[opts.side].open))
        const centerY = quantize(opts.cy - 20 - open * 2 - top)
        const expressionDirection =
          direction * (1 + emotionWeight(face, Emotion.ANGRY) * 0.2 - emotionWeight(face, Emotion.SAD) * 2)
        const rotation = quantize((Math.PI / 8) * expressionDirection)
        if (centerY === this.#centerY && rotation === this.#rotation) return

        this.#centerY = centerY
        this.#rotation = rotation
        mask.clear()
        mask.fillRotatedEllipse(centerX - left, centerY, 12, 5, rotation)
        this.revision++
        port.invalidate()
      }

      onDraw(port: Gray16MaskPortInstance) {
        port.drawGray(mask, this.color)
      }
    },
  }
})
