import { Outline } from 'commodetto/outline'
import type { FaceSkinPalette } from 'face-skin'
import { DEFAULT_FACE_PRIMARY_COLOR, Emotion, type FaceEyeKey, type FaceState, toPiuColorNumber } from 'face-state'
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
  emotion: FaceState['emotion'],
): Outline {
  if (!dogEyebrowOutlineCache) dogEyebrowOutlineCache = new Map()
  const key = `${cx}:${cy}:${direction}:${openStep}:${emotion}`
  const cached = dogEyebrowOutlineCache.get(key)
  if (cached) return cached

  const open = unitFromStep(openStep)
  let d = direction
  if (emotion === Emotion.ANGRY) d *= 1.2
  else if (emotion === Emotion.SAD) d *= -1

  const path = new Outline.CanvasPath()
  const cxAdj = cx + 8 * direction
  const cyAdj = cy - 20 - open * 2
  path.ellipse(cxAdj, cyAdj, 12, 5, (Math.PI / 8) * d, 0, FULL_TURN)

  const outline = Outline.fill(path)
  return rememberCachedValue(dogEyebrowOutlineCache, key, outline)
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
      #lastOpenStep = -1
      #lastEmotion: FaceState['emotion'] | null = null
      #palette: FaceSkinPalette | null = null
      #primary = DEFAULT_FACE_PRIMARY_COLOR

      onCreate(shape: PositionedShape) {
        this.#updatePath(shape, quantizeUnit(1), Emotion.NEUTRAL)
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
        const emotion = face.emotion
        if (openStep === this.#lastOpenStep && emotion === this.#lastEmotion) return
        this.#updatePath(shape, openStep, emotion)
      }

      #updatePath(shape: PositionedShape, openStep: number, emotion: FaceState['emotion']) {
        this.#lastOpenStep = openStep
        this.#lastEmotion = emotion
        shape.fillOutline = getDogEyebrowFillOutline(cx, cy, direction, openStep, emotion)
        shape.strokeOutline = undefined
      }
    },
  }
})
