import { Outline } from 'commodetto/outline'
import type { FaceSkinPalette } from 'face-skin'
import { DEFAULT_FACE_PRIMARY_COLOR, Emotion, type FaceState, toPiuColorNumber } from 'face-state'
import { getFillSkin, quantizeUnit, rememberCachedValue, unitFromStep } from 'parts/shape-utils'
import type { Skin as PiuSkin } from 'piu/MC'
import type { Shape as PiuShape } from 'piu/shape'
import { defineShapeTemplate } from 'template'

export type MouthOptions = {
  cx: number
  cy: number
  minWidth?: number
  maxWidth?: number
  minHeight?: number
  maxHeight?: number
}

type PositionedShape = Omit<PiuShape, 'fillOutline' | 'strokeOutline'> & {
  skin?: PiuSkin
  state?: number
  fillOutline?: Outline
  strokeOutline?: Outline
}

/** 口角の上下量。maxHeight に対する比で持つので、小さい顔でも比率が保たれる。 */
const BEND_RATIO = 0.3

let mouthOutlineCache: Map<string, Outline> | null = null

/**
 * 表情ごとの口の曲がり方。画面座標は下が正なので、
 * 正の値は口の中央が下がること、つまり口角が上がることを意味する。
 */
function bendDirection(emotion: FaceState['emotion']): number {
  switch (emotion) {
    case Emotion.HAPPY:
      return 1
    case Emotion.SAD:
    case Emotion.ANGRY:
      return -1
    default:
      return 0
  }
}

function getMouthFillOutline(
  minWidth: number,
  maxWidth: number,
  minHeight: number,
  maxHeight: number,
  openStep: number,
  emotion: FaceState['emotion'],
): Outline {
  if (!mouthOutlineCache) mouthOutlineCache = new Map()
  const key = `${minWidth}:${maxWidth}:${minHeight}:${maxHeight}:${openStep}:${emotion}`
  const cached = mouthOutlineCache.get(key)
  if (cached) return cached

  const open = unitFromStep(openStep)
  const h = minHeight + (maxHeight - minHeight) * open
  const w = minWidth + (maxWidth - minWidth) * (1 - open)
  const x = (maxWidth - w) / 2
  const y = (maxHeight - h) / 2
  // 口を大きく開けるほど平らにする。発話中に表情の曲線が残ると口の形が崩れるため。
  const bend = maxHeight * BEND_RATIO * (1 - open) * bendDirection(emotion)

  const path = new Outline.CanvasPath()
  if (bend === 0) {
    path.rect(x, y, w, h)
  } else {
    // 上端と下端を同じだけ曲げて、太さを保ったまま口角を上下させる。
    // 二次ベジェは制御点の半分までしか寄らないので、狙った量の 2 倍を制御点に置く。
    const centerX = x + w / 2
    const control = bend * 2
    path.moveTo(x, y)
    path.quadraticCurveTo(centerX, y + control, x + w, y)
    path.lineTo(x + w, y + h)
    path.quadraticCurveTo(centerX, y + h + control, x, y + h)
    path.closePath()
  }

  const outline = Outline.fill(path)
  return rememberCachedValue(mouthOutlineCache, key, outline)
}

export const Mouth = defineShapeTemplate((opts: MouthOptions) => {
  const { cx, cy, minWidth = 50, maxWidth = 90, minHeight = 8, maxHeight = 58 } = opts

  return {
    left: cx - maxWidth / 2,
    top: cy - maxHeight / 2,
    width: maxWidth,
    height: maxHeight,
    skin: getFillSkin(DEFAULT_FACE_PRIMARY_COLOR),
    Behavior: class extends Behavior {
      #lastOpenStep = -1
      #lastEmotion: FaceState['emotion'] | null = null
      #palette: FaceSkinPalette | null = null
      #primary = DEFAULT_FACE_PRIMARY_COLOR

      onCreate(shape: PositionedShape) {
        this.#updatePath(shape, quantizeUnit(0), Emotion.NEUTRAL)
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
            shape.skin = getFillSkin(primary)
          }
        }

        const openStep = quantizeUnit(face.mouth.open)
        const emotion = face.emotion
        if (openStep === this.#lastOpenStep && emotion === this.#lastEmotion) return
        this.#updatePath(shape, openStep, emotion)
      }

      #updatePath(shape: PositionedShape, openStep: number, emotion: FaceState['emotion']) {
        this.#lastOpenStep = openStep
        this.#lastEmotion = emotion
        shape.fillOutline = getMouthFillOutline(minWidth, maxWidth, minHeight, maxHeight, openStep, emotion)
        shape.strokeOutline = undefined
      }
    },
  }
})
