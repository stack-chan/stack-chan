import { Outline } from 'commodetto/outline'
import type { FaceSkinPalette } from 'face-skin'
import { DEFAULT_FACE_PRIMARY_COLOR, type FaceState, toPiuColorNumber } from 'face-state'
import { getFillSkin } from 'parts/shape-utils'
import type { Shape as PiuShape } from 'piu/shape'
import { defineShapeTemplate } from 'template'

export type RelaxedMouthOptions = { cx: number; cy: number; width?: number; height?: number }

const outlines = new Map<string, Outline>()

function mouthOutline(width: number, height: number): Outline {
  const key = `${width}:${height}`
  const cached = outlines.get(key)
  if (cached) return cached
  const path = new Outline.CanvasPath()
  path.moveTo(1, height - 2)
  path.quadraticCurveTo(width / 2, 1, width - 1, height - 2)
  const outline = Outline.stroke(path, 4, Outline.LINECAP_ROUND)
  outlines.set(key, outline)
  return outline
}

export const RelaxedMouth = defineShapeTemplate((options: RelaxedMouthOptions) => {
  const width = options.width ?? 34
  const height = options.height ?? 15
  return {
    left: options.cx - width / 2,
    top: options.cy - height / 2,
    width,
    height,
    skin: getFillSkin(DEFAULT_FACE_PRIMARY_COLOR),
    strokeOutline: mouthOutline(width, height),
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
