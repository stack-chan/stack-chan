import { Outline } from 'commodetto/outline'
import type { FaceSkinPalette } from 'face-skin'
import { DEFAULT_FACE_PRIMARY_COLOR, type FaceState, toPiuColorNumber } from 'face-state'
import { getStrokeSkin, quantizeUnit, rememberCachedValue, unitFromStep } from 'parts/shape-utils'
import type { Skin as PiuSkin } from 'piu/MC'
import type { Shape as PiuShape } from 'piu/shape'
import { defineShapeTemplate } from 'template'

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

type PositionedShape = Omit<PiuShape, 'fillOutline' | 'strokeOutline'> & {
  skin?: PiuSkin
  state?: number
  fillOutline?: Outline
  strokeOutline?: Outline
}

const STROKE = 3
let dogMouthOutlineCache: Map<string, Outline> | null = null

function getDogMouthStrokeOutline(
  cx: number,
  cy: number,
  minWidth: number,
  maxWidth: number,
  minHeight: number,
  maxHeight: number,
  openStep: number,
): Outline {
  if (!dogMouthOutlineCache) dogMouthOutlineCache = new Map()
  const key = `${cx}:${cy}:${minWidth}:${maxWidth}:${minHeight}:${maxHeight}:${openStep}`
  const cached = dogMouthOutlineCache.get(key)
  if (cached) return cached

  const open = unitFromStep(openStep)
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

  const outline = Outline.stroke(path, STROKE)
  return rememberCachedValue(dogMouthOutlineCache, key, outline)
}

export const DogMouth = defineShapeTemplate((opts: DogMouthOptions) => {
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
    skin: getStrokeSkin(DEFAULT_FACE_PRIMARY_COLOR),
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
            shape.skin = getStrokeSkin(primary)
          }
        }

        const openStep = quantizeUnit(face.mouth.open)
        if (openStep === this.#lastOpenStep) return
        this.#updatePath(shape, openStep)
      }

      #updatePath(shape: PositionedShape, openStep: number) {
        this.#lastOpenStep = openStep
        shape.strokeOutline = getDogMouthStrokeOutline(cx, cy, minWidth, maxWidth, minHeight, maxHeight, openStep)
        shape.fillOutline = undefined
      }
    },
  }
})
