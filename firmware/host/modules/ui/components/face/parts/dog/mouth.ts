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
  smileStep: number,
): Outline {
  if (!dogMouthOutlineCache) dogMouthOutlineCache = new Map()
  const key = `${cx}:${cy}:${minWidth}:${maxWidth}:${minHeight}:${maxHeight}:${openStep}:${smileStep}`
  const cached = dogMouthOutlineCache.get(key)
  if (cached) return cached

  const open = unitFromStep(openStep)
  const h = minHeight + (maxHeight - minHeight) * open
  const w = minWidth + (maxWidth - minWidth) * open
  const x = cx - w / 2
  const y = cy - h / 2
  const smile = smileStep / 6
  const curve = 20 + smile * 8
  const edgeLift = smile * 5
  const path = new Outline.CanvasPath()

  path.moveTo(x, y - edgeLift)
  path.bezierCurveTo(x, y + curve, cx, y + curve, cx, y)
  path.bezierCurveTo(cx, y + curve, x + w, y + curve, x + w, y - edgeLift)
  if (h > 16) {
    path.moveTo(x + w / 4, y + 16)
    path.bezierCurveTo(x + w / 8, y + h, x + (w * 7) / 8, y + h, x + (w * 3) / 4, y + 16)
  }

  const outline = Outline.stroke(path, STROKE)
  return rememberCachedValue(dogMouthOutlineCache, key, outline)
}

function quantizeSigned(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(Math.max(-1, Math.min(1, value)) * 6)
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
      #lastSmileStep = -99
      #palette: FaceSkinPalette | null = null
      #primary = DEFAULT_FACE_PRIMARY_COLOR

      onCreate(shape: PositionedShape) {
        this.#updatePath(shape, quantizeUnit(0), 0)
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
        const smileStep = quantizeSigned(face.mouth.smile)
        if (openStep === this.#lastOpenStep && smileStep === this.#lastSmileStep) return
        this.#updatePath(shape, openStep, smileStep)
      }

      #updatePath(shape: PositionedShape, openStep: number, smileStep: number) {
        this.#lastOpenStep = openStep
        this.#lastSmileStep = smileStep
        shape.strokeOutline = getDogMouthStrokeOutline(
          cx,
          cy,
          minWidth,
          maxWidth,
          minHeight,
          maxHeight,
          openStep,
          smileStep,
        )
        shape.fillOutline = undefined
      }
    },
  }
})
