import { Outline } from 'commodetto/outline'
import type { FaceSkinPalette } from 'face-skin'
import { DEFAULT_FACE_PRIMARY_COLOR, type FaceEyeKey, type FaceState, toPiuColorNumber } from 'face-state'
import { getFillSkin } from 'parts/shape-utils'
import type { Shape as PiuShape } from 'piu/shape'
import { defineShapeTemplate } from 'template'

export type RelaxedEyeOptions = { cx: number; cy: number; side: FaceEyeKey; width?: number; height?: number }

const outlines = new Map<string, Outline>()

function eyeOutline(width: number, height: number, side: FaceEyeKey): Outline {
  const key = `${width}:${height}:${side}`
  const cached = outlines.get(key)
  if (cached) return cached
  const path = new Outline.CanvasPath()
  const y = side === 'left' ? 2 : 3
  path.moveTo(1, y)
  path.quadraticCurveTo(width / 2, height, width - 1, y)
  const outline = Outline.stroke(path, 5, Outline.LINECAP_ROUND)
  outlines.set(key, outline)
  return outline
}

export const RelaxedEye = defineShapeTemplate((options: RelaxedEyeOptions) => {
  const width = options.width ?? 42
  const height = options.height ?? 18
  return {
    left: options.cx - width / 2,
    top: options.cy - height / 2,
    width,
    height,
    skin: getFillSkin(DEFAULT_FACE_PRIMARY_COLOR),
    strokeOutline: eyeOutline(width, height, options.side),
    Behavior: class extends Behavior {
      #hasPalette = false
      #color = DEFAULT_FACE_PRIMARY_COLOR
      onFaceSkin(shape: PiuShape, palette: FaceSkinPalette) {
        this.#hasPalette = true
        shape.skin = palette.primary
      }
      onFaceState(shape: PiuShape, face: FaceState) {
        if (this.#hasPalette) return
        const color = toPiuColorNumber(face.theme.primary)
        if (color === this.#color) return
        this.#color = color
        shape.skin = getFillSkin(color)
      }
    },
  }
})
