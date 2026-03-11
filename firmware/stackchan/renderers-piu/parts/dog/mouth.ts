import type { Skin as PiuSkin } from 'piu/MC'
import type { Shape as PiuShape } from 'piu/shape'
import { Outline } from 'commodetto/outline'
import { defaultFaceContext, type FaceContext } from '../../face-context'

export type DogMouthOptions = {
  cx: number
  cy: number
  minWidth?: number
  maxWidth?: number
  minHeight?: number
  maxHeight?: number
  canvasWidth?: number
  canvasHeight?: number
}

type PositionedShape = PiuShape & { skin?: PiuSkin }

export function createDogMouth({
  cx,
  cy,
  minWidth = 50,
  maxWidth = 60,
  minHeight = 8,
  maxHeight = 24,
  canvasWidth = 320,
  canvasHeight = 200,
}: DogMouthOptions): PositionedShape {
  const shape = new Shape(null, {
    left: 0,
    top: 0,
    width: canvasWidth,
    height: canvasHeight,
    skin: new Skin({ stroke: defaultFaceContext.theme.primary }),
    Behavior: class extends Behavior {
      lastOpen = -1
      lastPrimary: string | null = null
      onFaceContext(shape: PositionedShape, face: FaceContext) {
        this.updateSkin(shape, face)
        const open = face.mouth.open
        if (open !== this.lastOpen) {
          this.updatePath(shape, open)
        }
      }
      updateSkin(shape: PositionedShape, face: FaceContext) {
        const primary = face.theme.primary
        if (primary === this.lastPrimary) return
        this.lastPrimary = primary
        shape.skin = new Skin({ stroke: primary })
      }
      updatePath(shape: PositionedShape, open: number) {
        this.lastOpen = open
        const h = minHeight + (maxHeight - minHeight) * open
        const w = minWidth + (maxWidth - minWidth) * open
        const x = cx - w / 2
        const y = cy - h / 2
        const path = new Outline.CanvasPath()
        path.moveTo(x, y)
        path.bezierCurveTo(x, y + 20, cx, y + 20, cx, y)
        path.bezierCurveTo(cx, y + 20, x + w, y + 20, x + w, y)
        if (h > 16) {
          path.moveTo(x + w / 4, y + 16)
          path.bezierCurveTo(x + w / 8, y + h, x + (w * 7) / 8, y + h, x + (w * 3) / 4, y + 16)
        }
        shape.strokeOutline = Outline.stroke(path, 3)
        shape.fillOutline = undefined
      }
    },
  }) as PositionedShape
  return shape
}
