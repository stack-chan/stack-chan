import { Outline } from 'commodetto/outline'
import type { FaceSkinPalette } from 'face-skin'
import {
  DEFAULT_FACE_PRIMARY_COLOR,
  DEFAULT_FACE_SECONDARY_COLOR,
  Emotion,
  type FaceEyeKey,
  type FaceState,
  toPiuColorNumber,
} from 'face-state'
import { FULL_TURN, getFillSkin, quantizeUnit, unitFromStep } from 'parts/shape-utils'
import type { Container as PiuContainer, Skin as PiuSkin } from 'piu/MC'
import type { Shape as PiuShape } from 'piu/shape'
import { defineShapeTemplate } from 'template'

export type EyeOptions = {
  cx: number
  cy: number
  radius?: number
  side: FaceEyeKey
  eyelidWidth?: number
  eyelidHeight?: number
}

type IrisOptions = {
  radius: number
  left: number
  top: number
}

type EyelidOptions = {
  cx: number
  cy: number
  width: number
  height: number
  side: FaceEyeKey
}

type PositionedShape = Omit<PiuShape, 'fillOutline' | 'strokeOutline'> & {
  skin?: PiuSkin
  state?: number
  fillOutline?: Outline
  strokeOutline?: Outline
}

type PositionedContent = PiuShape & {
  coordinates?: { left?: number; top?: number; width?: number; height?: number }
}

let irisOutlineCache: Map<number, Outline> | null = null
let eyelidOutlineCache: Map<string, Outline> | null = null

function getIrisFillOutline(radius: number): Outline {
  if (!irisOutlineCache) irisOutlineCache = new Map()
  const cached = irisOutlineCache.get(radius)
  if (cached) return cached

  const path = new Outline.CanvasPath()
  path.arc(radius, radius, radius, 0, FULL_TURN)
  path.closePath()
  const outline = Outline.fill(path)
  irisOutlineCache.set(radius, outline)
  return outline
}

function getEyelidFillOutline(
  width: number,
  height: number,
  side: FaceEyeKey,
  openStep: number,
  emotion: FaceState['emotion'],
): Outline {
  if (!eyelidOutlineCache) eyelidOutlineCache = new Map()
  const key = `${width}:${height}:${side}:${openStep}:${emotion}`
  const cached = eyelidOutlineCache.get(key)
  if (cached) return cached

  const w = width
  const h = height
  const x = 0
  const y = 0
  const open = unitFromStep(openStep)
  const closedH = h * (1 - open)
  const path = new Outline.CanvasPath()

  switch (emotion) {
    case Emotion.ANGRY:
    case Emotion.SAD: {
      let h1 = y + (h + closedH) / 2
      let h2 = y + closedH
      if (side === 'left') {
        ;[h1, h2] = [h2, h1]
      }
      if (emotion === Emotion.SAD) {
        ;[h1, h2] = [h2, h1]
      }
      path.moveTo(x, y)
      path.lineTo(x, h1)
      path.lineTo(x + w, h2)
      path.lineTo(x + w, y)
      path.closePath()
      break
    }
    case Emotion.SLEEPY:
      path.rect(x, y, w, h * 0.5 + closedH * 0.5)
      break
    case Emotion.HAPPY:
      path.rect(x, y, w, closedH * 0.6)
      path.rect(x, y + h * 0.6, w, h * 0.4)
      break
    default:
      path.rect(x, y, w, closedH)
      break
  }

  const outline = Outline.fill(path)
  eyelidOutlineCache.set(key, outline)
  return outline
}

export const Eyelid = defineShapeTemplate((opts: EyelidOptions) => {
  const { width, height, side } = opts
  return {
    left: opts.cx - width / 2,
    top: opts.cy - height / 2,
    width,
    height,
    skin: getFillSkin(DEFAULT_FACE_SECONDARY_COLOR),
    Behavior: class extends Behavior {
      #lastOpenStep = -1
      #lastEmotion: FaceState['emotion'] | null = null
      #palette: FaceSkinPalette | null = null
      #secondary = DEFAULT_FACE_SECONDARY_COLOR

      onCreate(shape: PositionedShape) {
        this.#updatePath(shape, quantizeUnit(1), Emotion.NEUTRAL)
      }

      onFaceSkin(shape: PositionedShape, palette: FaceSkinPalette) {
        this.#palette = palette
        shape.skin = palette.secondary
      }

      onFaceState(shape: PositionedShape, face: FaceState) {
        if (!this.#palette) {
          const secondary = toPiuColorNumber(face.theme.secondary)
          if (secondary !== this.#secondary) {
            this.#secondary = secondary
            shape.skin = getFillSkin(secondary)
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
        shape.fillOutline = getEyelidFillOutline(width, height, side, openStep, emotion)
        shape.strokeOutline = undefined
      }
    },
  }
})

const Iris = defineShapeTemplate((opts: IrisOptions) => {
  const radius = opts.radius
  const diameter = radius * 2
  return {
    left: opts.left,
    top: opts.top,
    width: diameter,
    height: diameter,
    skin: getFillSkin(DEFAULT_FACE_PRIMARY_COLOR),
    Behavior: class extends Behavior {
      #palette: FaceSkinPalette | null = null
      #primary = DEFAULT_FACE_PRIMARY_COLOR

      onCreate(shape: PositionedShape) {
        shape.fillOutline = getIrisFillOutline(radius)
        shape.strokeOutline = undefined
      }

      onFaceSkin(shape: PositionedShape, palette: FaceSkinPalette) {
        this.#palette = palette
        shape.skin = palette.primary
      }

      onFaceState(shape: PositionedShape, face: FaceState) {
        if (this.#palette) return
        const primary = toPiuColorNumber(face.theme.primary)
        if (primary === this.#primary) return
        this.#primary = primary
        shape.skin = getFillSkin(primary)
      }
    },
  }
})

export const Eye = Container.template((opts: EyeOptions) => {
  const radius = opts.radius ?? 8
  const diameter = radius * 2
  const eyelidWidth = opts.eyelidWidth ?? radius * 3
  const eyelidHeight = opts.eyelidHeight ?? radius * 3
  const width = Math.max(diameter, eyelidWidth)
  const height = Math.max(diameter, eyelidHeight)
  const irisBaseLeft = (width - diameter) / 2
  const irisBaseTop = (height - diameter) / 2
  const irisBaseCoordinates = { left: irisBaseLeft, top: irisBaseTop, width: diameter, height: diameter }
  const iris = new Iris({ radius, left: irisBaseLeft, top: irisBaseTop }) as PositionedContent

  return {
    clip: true,
    left: opts.cx - width / 2,
    top: opts.cy - height / 2,
    width,
    height,
    Behavior: class extends Behavior {
      #lastGazeX = NaN
      #lastGazeY = NaN

      onFaceState(_container: PiuContainer, face: FaceState) {
        const eye = face.eyes[opts.side]
        const offsetX = (eye.gazeX ?? 0) * 2
        const offsetY = (eye.gazeY ?? 0) * 2
        if (offsetX === this.#lastGazeX && offsetY === this.#lastGazeY) return

        this.#lastGazeX = offsetX
        this.#lastGazeY = offsetY
        iris.coordinates = {
          ...irisBaseCoordinates,
          left: irisBaseLeft + offsetX,
          top: irisBaseTop + offsetY,
        }
      }
    },
    contents: [
      iris,
      new Eyelid({
        cx: width / 2,
        cy: height / 2,
        width: eyelidWidth,
        height: eyelidHeight,
        side: opts.side,
      }),
    ],
  }
})
