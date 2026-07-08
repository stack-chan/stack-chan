import { Outline } from 'commodetto/outline'
import type { FaceSkinPalette } from 'face-skin'
import { DEFAULT_FACE_PRIMARY_COLOR, type FaceState, toPiuColorNumber } from 'face-state'
import { getFillStrokeSkin, quantizeUnit, rememberCachedValue, unitFromStep } from 'parts/shape-utils'
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

let dogNoseOutlineCache: Map<string, Outline> | null = null

function getDogNoseFillOutline(
  cx: number,
  cy: number,
  minHeight: number,
  maxHeight: number,
  openStep: number,
): Outline {
  if (!dogNoseOutlineCache) dogNoseOutlineCache = new Map()
  const key = `${cx}:${cy}:${minHeight}:${maxHeight}:${openStep}`
  const cached = dogNoseOutlineCache.get(key)
  if (cached) return cached

  const open = unitFromStep(openStep)
  const h = minHeight + (maxHeight - minHeight) * open
  const y = cy - h / 2
  const path = new Outline.CanvasPath()
  path.moveTo(cx - 8, y - 16)
  path.quadraticCurveTo(cx, y - 18, cx + 8, y - 16)
  path.bezierCurveTo(cx + 6, y - 4, cx - 6, y - 4, cx - 8, y - 16)
  path.closePath()

  const outline = Outline.fill(path)
  return rememberCachedValue(dogNoseOutlineCache, key, outline)
}

export const DogNose = defineShapeTemplate((opts: DogNoseOptions) => {
  const { cx, cy, minHeight = 8, maxHeight = 24, canvasWidth = 320, canvasHeight = 200 } = opts

  return {
    left: 0,
    top: 0,
    width: canvasWidth,
    height: canvasHeight,
    skin: getFillStrokeSkin(DEFAULT_FACE_PRIMARY_COLOR),
    Behavior: class extends Behavior {
      #lastOpenStep = -1
      #palette: FaceSkinPalette | null = null
      #primary = DEFAULT_FACE_PRIMARY_COLOR

      onCreate(shape: PositionedShape) {
        this.#updatePath(shape, quantizeUnit(0))
      }

      onFaceSkin(shape: PositionedShape, palette: FaceSkinPalette) {
        this.#palette = palette
        shape.skin = palette.primary
      }

      onFaceState(shape: PositionedShape, face: FaceState) {
        if (!this.#palette) {
          const primary = toPiuColorNumber(face.theme.primary)
          if (primary !== this.#primary) {
            this.#primary = primary
            shape.skin = getFillStrokeSkin(primary)
          }
        }

        const openStep = quantizeUnit(face.mouth.open)
        if (openStep === this.#lastOpenStep) return
        this.#updatePath(shape, openStep)
      }

      #updatePath(shape: PositionedShape, openStep: number) {
        this.#lastOpenStep = openStep
        shape.fillOutline = getDogNoseFillOutline(cx, cy, minHeight, maxHeight, openStep)
        shape.strokeOutline = undefined
      }
    },
  }
})
