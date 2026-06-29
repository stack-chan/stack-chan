import { Outline } from 'commodetto/outline'
import type { FaceSkinPalette } from 'face-skin'
import { DEFAULT_FACE_PRIMARY_COLOR, Emotion, type FaceEyeKey, type FaceState, toPiuColorNumber } from 'face-state'
import type { Skin as PiuSkin } from 'piu/MC'
import type { Shape as PiuShape } from 'piu/shape'
import { defineShapeTemplate } from 'template'

export type EyebrowOptions = {
  cx: number
  cy: number
  side: FaceEyeKey
  canvasWidth?: number
  canvasHeight?: number
}

type PositionedShape = Omit<PiuShape, 'fillOutline' | 'strokeOutline'> & {
  skin?: PiuSkin
  state?: number
  fillOutline?: Outline
  strokeOutline?: Outline
}

export const DogEyebrow = defineShapeTemplate((opts: EyebrowOptions) => {
  const { cx, cy, side, canvasWidth = 320, canvasHeight = 120 } = opts
  const direction = side === 'left' ? 1 : -1
  return {
    left: 0,
    top: 0,
    width: canvasWidth,
    height: canvasHeight,
    skin: new Skin({ fill: DEFAULT_FACE_PRIMARY_COLOR }),
    Behavior: class extends Behavior {
      lastKey: string | null = null
      palette: FaceSkinPalette | null = null
      onFaceSkin(shape: PositionedShape, palette: FaceSkinPalette) {
        this.palette = palette
        shape.skin = palette.palette
        shape.state = palette.primaryState
      }
      updatePath(shape: PositionedShape, face: FaceState) {
        const eye = face.eyes[side]
        let d = direction
        if (face.emotion === Emotion.ANGRY) d *= 1.2
        else if (face.emotion === Emotion.SAD) d *= -1
        const path = new Outline.CanvasPath()
        const cxAdj = cx + 8 * direction
        const cyAdj = cy - 20 - eye.open * 2
        path.ellipse(cxAdj, cyAdj, 12, 5, (Math.PI / 8) * d, 0, 2 * Math.PI)
        shape.fillOutline = Outline.fill(path)
        shape.strokeOutline = undefined
        this.lastKey = `${eye.open.toFixed(3)}:${face.emotion}`
      }
      onFaceState(shape: PositionedShape, face: FaceState) {
        if (!this.palette) {
          const primary = toPiuColorNumber(face.theme.primary)
          shape.skin = new Skin({ fill: primary, stroke: primary })
        }
        const eye = face.eyes[side]
        const key = `${eye.open.toFixed(3)}:${face.emotion}`
        if (key !== this.lastKey) {
          this.updatePath(shape, face)
        }
      }
    },
  }
})
