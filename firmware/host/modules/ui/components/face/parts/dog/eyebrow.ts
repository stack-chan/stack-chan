import { Outline } from 'commodetto/outline'
import type { FaceSkinPalette } from 'face-skin'
import { DEFAULT_FACE_PRIMARY_COLOR, type FaceEyeKey, type FaceState, toPiuColorNumber } from 'face-state'
import { FULL_TURN, getFillStrokeSkin, quantizeUnit, rememberCachedValue, unitFromStep } from 'parts/shape-utils'
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

let dogEyebrowOutlineCache: Map<string, Outline> | null = null

function getDogEyebrowFillOutline(
  cx: number,
  cy: number,
  direction: number,
  openStep: number,
  browTiltStep: number,
): Outline {
  if (!dogEyebrowOutlineCache) dogEyebrowOutlineCache = new Map()
  const key = `${cx}:${cy}:${direction}:${openStep}:${browTiltStep}`
  const cached = dogEyebrowOutlineCache.get(key)
  if (cached) return cached

  const open = unitFromStep(openStep)
  const browTilt = browTiltStep / 6
  const d = direction * browTilt

  const path = new Outline.CanvasPath()
  const cxAdj = cx + 8 * direction
  const cyAdj = cy - 20 - open * 2
  path.ellipse(cxAdj, cyAdj, 12, 5, (Math.PI / 6) * d, 0, FULL_TURN)

  const outline = Outline.fill(path)
  return rememberCachedValue(dogEyebrowOutlineCache, key, outline)
}

function quantizeSigned(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(Math.max(-1, Math.min(1, value)) * 6)
}

export const DogEyebrow = defineShapeTemplate((opts: EyebrowOptions) => {
  const { cx, cy, side, canvasWidth = 320, canvasHeight = 120 } = opts
  const direction = side === 'left' ? 1 : -1

  return {
    left: 0,
    top: 0,
    width: canvasWidth,
    height: canvasHeight,
    skin: getFillStrokeSkin(DEFAULT_FACE_PRIMARY_COLOR),
    Behavior: class extends Behavior {
      #lastBrowTiltStep = -99
      #lastOpenStep = -1
      #palette: FaceSkinPalette | null = null
      #primary = DEFAULT_FACE_PRIMARY_COLOR

      onCreate(shape: PositionedShape) {
        this.#updatePath(shape, quantizeUnit(1), 0)
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

        const eye = face.eyes[side]
        const openStep = quantizeUnit(eye.open)
        const browTiltStep = quantizeSigned(eye.browTilt)
        if (openStep === this.#lastOpenStep && browTiltStep === this.#lastBrowTiltStep) return
        this.#updatePath(shape, openStep, browTiltStep)
      }

      #updatePath(shape: PositionedShape, openStep: number, browTiltStep: number) {
        this.#lastOpenStep = openStep
        this.#lastBrowTiltStep = browTiltStep
        shape.fillOutline = getDogEyebrowFillOutline(cx, cy, direction, openStep, browTiltStep)
        shape.strokeOutline = undefined
      }
    },
  }
})
