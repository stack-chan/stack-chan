import type { Skin as PiuSkin } from 'piu/MC'
import type { Shape as PiuShape } from 'piu/shape'
import { Outline } from 'commodetto/outline'
import { defaultFaceContext, type FaceContext } from '../../face-context'

export type DogNoseOptions = {
  cx: number
  cy: number
  minHeight?: number
  maxHeight?: number
  canvasWidth?: number
  canvasHeight?: number
}

type PositionedShape = PiuShape & { skin?: PiuSkin }

export function createDogNose({
  cx,
  cy,
  minHeight = 8,
  maxHeight = 24,
  canvasWidth = 320,
  canvasHeight = 200,
}: DogNoseOptions): PositionedShape {
  const shape = new Shape(null, {
    left: 0,
    top: 0,
    width: canvasWidth,
    height: canvasHeight,
    skin: new Skin({ fill: defaultFaceContext.theme.primary }),
    Behavior: class extends Behavior {
      lastOpen = -1
      lastPrimary: string | null = null
      updateSkin(shape: PositionedShape, face: FaceContext) {
        const primary = face.theme.primary
        if (primary === this.lastPrimary) return
        this.lastPrimary = primary
        shape.skin = new Skin({ fill: primary, stroke: primary })
      }
      updatePath(shape: PositionedShape, open: number) {
        this.lastOpen = open
        const h = minHeight + (maxHeight - minHeight) * open
        const y = cy - h / 2
        const path = new Outline.CanvasPath()
        path.moveTo(cx - 8, y - 16)
        path.quadraticCurveTo(cx, y - 18, cx + 8, y - 16)
        path.bezierCurveTo(cx + 6, y - 4, cx - 6, y - 4, cx - 8, y - 16)
        path.closePath()
        shape.fillOutline = Outline.fill(path)
        shape.strokeOutline = undefined
      }
      onFaceContext(shape: PositionedShape, face: FaceContext) {
        this.updateSkin(shape, face)
        const open = face.mouth.open
        if (open !== this.lastOpen) this.updatePath(shape, open)
      }
    },
  }) as PositionedShape

  return shape
}
