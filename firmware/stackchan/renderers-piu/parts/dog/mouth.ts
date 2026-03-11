import type { Skin as PiuSkin } from 'piu/MC'
import type { Shape as PiuShape } from 'piu/shape'
import { Outline } from 'commodetto/outline'
import { defaultFaceContext, type FaceContext } from '../../face-context'
import type { FaceSkinPalette } from 'face-skin'

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

type PositionedShape = PiuShape & { skin?: PiuSkin; state?: number }

export const DogMouth = Shape.template((opts: DogMouthOptions) => {
  const {
    cx,
    cy,
    minWidth = 50,
    maxWidth = 60,
    minHeight = 8,
    maxHeight = 24,
    canvasWidth = 320,
    canvasHeight = 200,
  } = opts
  return {
    left: 0,
    top: 0,
    width: canvasWidth,
    height: canvasHeight,
    skin: new Skin({ stroke: defaultFaceContext.theme.primary }),
    Behavior: class extends Behavior {
      lastOpen = -1
      palette: FaceSkinPalette | null = null
      onFaceSkin(shape: PositionedShape, palette: FaceSkinPalette) {
        this.palette = palette
        shape.skin = palette.palette
        shape.state = palette.primaryState
      }
      onFaceContext(shape: PositionedShape, face: FaceContext) {
        if (!this.palette) {
          shape.skin = new Skin({ stroke: face.theme.primary })
        }
        const open = face.mouth.open
        if (open !== this.lastOpen) {
          this.updatePath(shape, open)
        }
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
  }
})
