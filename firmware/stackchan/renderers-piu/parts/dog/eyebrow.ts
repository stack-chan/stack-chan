import type { Skin as PiuSkin } from 'piu/MC'
import type { Shape as PiuShape } from 'piu/shape'
import { Outline } from 'commodetto/outline'
import { defaultFaceContext, type FaceContext } from '../../face-context'

export type EyebrowOptions = {
  cx: number
  cy: number
  side: keyof FaceContext['eyes']
  canvasWidth?: number
  canvasHeight?: number
}

type PositionedShape = PiuShape & { skin?: PiuSkin }

export const DogEyebrow = Shape.template((opts: EyebrowOptions) => {
  const { cx, cy, side, canvasWidth = 320, canvasHeight = 120 } = opts
  const direction = side === 'left' ? 1 : -1
  return {
    left: 0,
    top: 0,
    width: canvasWidth,
    height: canvasHeight,
    skin: new Skin({ fill: defaultFaceContext.theme.primary }),
    Behavior: class extends Behavior {
      lastKey: string | null = null
      lastPrimary: string | null = null
      updateSkin(shape: PositionedShape, face: FaceContext) {
        const primary = face.theme.primary
        if (primary === this.lastPrimary) return
        this.lastPrimary = primary
        shape.skin = new Skin({ fill: primary, stroke: primary })
      }
      updatePath(shape: PositionedShape, face: FaceContext) {
        const eye = face.eyes[side]
        let d = direction
        if (face.emotion === 'ANGRY') d *= 1.2
        else if (face.emotion === 'SAD') d *= -1
        const path = new Outline.CanvasPath()
        const cxAdj = cx + 8 * direction
        const cyAdj = cy - 20 - eye.open * 2
        path.ellipse(cxAdj, cyAdj, 12, 5, (Math.PI / 8) * d, 0, 2 * Math.PI)
        shape.fillOutline = Outline.fill(path)
        shape.strokeOutline = undefined
        this.lastKey = `${eye.open.toFixed(3)}:${face.emotion}`
      }
      onFaceContext(shape: PositionedShape, face: FaceContext) {
        this.updateSkin(shape, face)
        const eye = face.eyes[side]
        const key = `${eye.open.toFixed(3)}:${face.emotion}`
        if (key !== this.lastKey) {
          this.updatePath(shape, face)
        }
      }
    },
  }
})
