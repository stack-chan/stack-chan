import { Outline } from 'commodetto/outline'
import type { FaceSkinPalette } from 'face-skin'
import { DEFAULT_FACE_PRIMARY_COLOR, type FaceState, toPiuColorNumber } from 'face-state'
import type { Skin as PiuSkin } from 'piu/MC'
import type { Shape as PiuShape } from 'piu/shape'
import { defineShapeTemplate } from 'template'

export type DogNoseOptions = {
  cx: number
  cy: number
  minHeight?: number
  maxHeight?: number
  canvasWidth?: number
  canvasHeight?: number
}

type PositionedShape = Omit<PiuShape, 'fillOutline' | 'strokeOutline'> & {
  skin?: PiuSkin
  state?: number
  fillOutline?: Outline
  strokeOutline?: Outline
}

export const DogNose = defineShapeTemplate((opts: DogNoseOptions) => {
  const { cx, cy, minHeight = 8, maxHeight = 24, canvasWidth = 320, canvasHeight = 200 } = opts
  return {
    left: 0,
    top: 0,
    width: canvasWidth,
    height: canvasHeight,
    skin: new Skin({ fill: DEFAULT_FACE_PRIMARY_COLOR }),
    Behavior: class extends Behavior {
      lastOpen = -1
      palette: FaceSkinPalette | null = null
      onFaceSkin(shape: PositionedShape, palette: FaceSkinPalette) {
        this.palette = palette
        shape.skin = palette.palette
        shape.state = palette.primaryState
      }
      updateSkin(shape: PositionedShape, face: FaceState) {
        if (this.palette) return
        const primary = toPiuColorNumber(face.theme.primary)
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
      onFaceState(shape: PositionedShape, face: FaceState) {
        this.updateSkin(shape, face)
        const open = face.mouth.open
        if (open !== this.lastOpen) this.updatePath(shape, open)
      }
    },
  }
})
