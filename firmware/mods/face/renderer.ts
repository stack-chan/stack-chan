import config from 'mc/config'
import Poco, { PocoPrototype } from 'commodetto/Poco'
import { Outline, CanvasPath } from 'commodetto/outline'
import deepEqual from 'deepEqual'
import structuredClone from 'structuredClone'
import { randomBetween, quantize, normRand } from 'stackchan-util'

/* global screen */
const INTERVAL = 1000 / 10

// Types

type EyeContext = {
  open: number
  gazeX: number
  gazeY: number
}
type MouthContext = {
  open: number
}
type Color = [r: number, g: number, b: number]

export const Emotion = Object.freeze({
  NEUTRAL: 'NEUTRAL',
  ANGRY: 'ANGRY',
  SAD: 'SAD',
  HAPPY: 'HAPPY',
  SLEEPY: 'SLEEPY',
  DOUBTFUL: 'DOUBTFUL',
  COLD: 'COLD',
  HOT: 'HOT',
})

export type Emotion = typeof Emotion[keyof typeof Emotion]

/**
 * The context of the face representing physiological state and drawing settings.
 */
export type FaceContext = {
  mouth: MouthContext
  eyes: {
    left: EyeContext
    right: EyeContext
  }
  breath: number
  emotion: Emotion
  theme: {
    primary: Color
    secondary: Color
  }
}

export const defaultFaceContext: Readonly<FaceContext> = Object.freeze({
  mouth: Object.freeze({
    open: 0,
  }),
  eyes: Object.freeze({
    left: Object.freeze({
      open: 1,
      gazeX: 0,
      gazeY: 0,
    }),
    right: Object.freeze({
      open: 1,
      gazeX: 0,
      gazeY: 0,
    }),
  }),
  breath: 1,
  emotion: Emotion.NEUTRAL,
  theme: Object.freeze({
    primary: [0xff, 0xff, 0xff],
    secondary: [0x00, 0x00, 0x00],
  }),
} as const)

export function copyFaceContext(src: Readonly<FaceContext>, dst: FaceContext) {
  dst.mouth.open = src.mouth.open
  let eyeDst = dst.eyes.left
  let eyeSrc = src.eyes.left
  eyeDst.open = eyeSrc.open
  eyeDst.gazeX = eyeSrc.gazeX
  eyeDst.gazeY = eyeSrc.gazeY
  eyeDst = dst.eyes.right
  eyeSrc = src.eyes.right
  eyeDst.open = eyeSrc.open
  eyeDst.gazeX = eyeSrc.gazeX
  eyeDst.gazeY = eyeSrc.gazeY
  dst.breath = src.breath
  dst.emotion = src.emotion
  let colorDst = dst.theme.primary
  let colorSrc = src.theme.primary
  colorDst[0] = colorSrc[0]
  colorDst[1] = colorSrc[1]
  colorDst[2] = colorSrc[2]
  colorDst = dst.theme.secondary
  colorSrc = src.theme.secondary
  colorDst[0] = colorSrc[0]
  colorDst[1] = colorSrc[1]
  colorDst[2] = colorSrc[2]
}

// Filters

export type FaceFilter<T = unknown> = (tick: number, face: FaceContext, arg?: T) => FaceContext
export type FaceFilterFactory<T, V = unknown> = (param: T) => FaceFilter<V>

export type FacePart<T = unknown> = (tick: number, path: CanvasPath, face: Readonly<FaceContext>, arg?: T) => void
export type FacePartFactory<T, V = unknown> = (param: T) => FacePart<V>

export type FaceEffect<T = unknown> = (
  tick: number,
  poco: PocoPrototype,
  face: Readonly<FaceContext>,
  end?: boolean,
  arg?: T
) => void
export type FaceEffectFactory<T, V = unknown> = (param: T) => FaceEffect<V>

function linearInEaseOut(fraction: number): number {
  if (fraction < 0.25) {
    return 1 - fraction * 4
  } else {
    return (Math.pow(fraction - 0.25, 2) * 16) / 9
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function linearInLinearOut(fraction: number): number {
  if (fraction < 0.5) {
    return 1 - fraction * 2
  } else {
    return fraction * 2 - 1
  }
}

export const useBlink: FaceFilterFactory<{ openMin: number; openMax: number; closeMin: number; closeMax: number }> = ({
  openMin,
  openMax,
  closeMin,
  closeMax,
}) => {
  let isBlinking = false
  let nextToggle = randomBetween(openMin, openMax)
  let count = 0
  return (tickMillis: number, face: FaceContext) => {
    let eyeOpen = 1
    if (isBlinking) {
      const fraction = linearInEaseOut(count / nextToggle)
      eyeOpen = 0.2 + fraction * 0.8
    }
    count += tickMillis
    if (count >= nextToggle) {
      isBlinking = !isBlinking
      count = 0
      nextToggle = isBlinking ? randomBetween(closeMin, closeMax) : randomBetween(openMin, openMax)
    }
    Object.values(face.eyes).map((eye) => {
      eye.open *= eyeOpen
    })
    return face
  }
}

export const useSaccade: FaceFilterFactory<{ updateMin: number; updateMax: number; gain: number }> = ({
  updateMin,
  updateMax,
  gain,
}) => {
  let nextToggle = randomBetween(updateMin, updateMax)
  let saccadeX = 0
  let saccadeY = 0
  return (tickMillis, face) => {
    nextToggle -= tickMillis
    if (nextToggle < 0) {
      saccadeX = normRand(0, gain)
      saccadeY = normRand(0, gain)
      nextToggle = randomBetween(updateMin, updateMax)
    }
    Object.values(face.eyes).map((eye) => {
      eye.gazeX += saccadeX
      eye.gazeY += saccadeY
    })
    return face
  }
}

export const useBreath: FaceFilterFactory<{ duration: number }> = ({ duration }) => {
  let time = 0
  return (tickMillis, face) => {
    time += tickMillis % duration
    face.breath = quantize(Math.sin((2 * Math.PI * time) / duration), 8)
    return face
  }
}

// Renderers

export const useDrawEyelid: FacePartFactory<{
  cx: number
  cy: number
  width: number
  height: number
  side: keyof FaceContext['eyes']
}> =
  ({ cx, cy, width, height, side }) =>
  (_tick, path, { eyes }) => {
    const eye = eyes[side]
    const w = width
    const h = height * (1 - eye.open)
    const x = cx - width / 2
    const y = cy - height / 2
    path.rect(x, y, w, h)
  }

export const useDrawEye: FacePartFactory<{
  cx: number
  cy: number
  radius?: number
  side: keyof FaceContext['eyes']
}> =
  ({ cx, cy, radius = 8, side }) =>
  (_tick, path, { eyes }) => {
    const eye = eyes[side]
    const offsetX = (eye.gazeX ?? 0) * 2
    const offsetY = (eye.gazeY ?? 0) * 2
    path.arc(cx + offsetX, cy + offsetY, radius, 0, 2 * Math.PI)
  }

export const useDrawMouth: FacePartFactory<{
  cx: number
  cy: number
  minWidth?: number
  maxWidth?: number
  minHeight?: number
  maxHeight?: number
}> =
  ({ cx, cy, minWidth = 50, maxWidth = 90, minHeight = 8, maxHeight = 58 }) =>
  (_tick, path, { mouth }) => {
    const openRatio = mouth.open
    const h = minHeight + (maxHeight - minHeight) * openRatio
    const w = minWidth + (maxWidth - minWidth) * (1 - openRatio)
    const x = cx - w / 2
    const y = cy - h / 2
    path.rect(x, y, w, h)
  }

type LayerProps = {
  colorName?: keyof FaceContext['theme']
  type?: 'fill' | 'stroke'
}
// under development
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export class Layer {
  #renderers: Map<string, FacePart>
  #colorName: keyof FaceContext['theme']
  #type: 'fill' | 'stroke'
  constructor({ colorName = 'primary', type = 'fill' }: LayerProps) {
    this.#renderers = new Map()
    this.#colorName = colorName
    this.#type = type
  }
  addPart(key: string, part: FacePart) {
    this.#renderers.set(key, part)
  }
  removePart(key) {
    this.#renderers.delete(key)
  }
  render(tick: number, poco: PocoPrototype, face: FaceContext) {
    const path = new Outline.CanvasPath()
    const color = poco.makeColor(...face.theme[this.#colorName])
    this.#renderers.forEach((render) => {
      render(tick, path, face)
    })
    let outline =
      this.#type === 'fill'
        ? Outline.fill(path).translate(0, face.breath * 3 ?? 0)
        : Outline.stroke(path, 6).translate(0, face.breath * 3 ?? 0)
    poco.blendOutline(color, 255, outline, 0, 0)
  }
}

export class RendererBase {
  _poco: PocoPrototype

  layers: Layer[]
  filters: FaceFilter[]
  effects: FaceEffect[]
  removingEffects: FaceEffect[]

  lastContext: FaceContext
  currentContext: FaceContext

  constructor(option?: { poco?: PocoPrototype }) {
    this._poco = option?.poco ?? new Poco(screen, { rotation: config.rotation })
    this.effects = []
    this.removingEffects = []
    this.layers = []
    this.lastContext = structuredClone(defaultFaceContext)
    this.currentContext = structuredClone(defaultFaceContext)
    this.filters = [
      useBlink({ openMin: 400, openMax: 5000, closeMin: 200, closeMax: 400 }),
      useBreath({ duration: 6000 }),
      useSaccade({ updateMin: 300, updateMax: 2000, gain: 0.2 }),
    ]
    this.clear()
  }
  update(interval = INTERVAL, faceContext: Readonly<FaceContext> = defaultFaceContext): void {
    copyFaceContext(faceContext, this.currentContext)
    this.filters.forEach((filter) => filter(interval, this.currentContext))

    const poco = this._poco
    const shouldClear = !deepEqual(this.currentContext.theme, this.lastContext.theme)
    const shouldRender = !deepEqual(this.currentContext, this.lastContext)
    const bg = poco.makeColor(...faceContext.theme.secondary)
    if (shouldClear) {
      poco.begin()
      poco.fillRectangle(bg, 0, 0, poco.width, poco.height)
    }
    if (shouldRender) {
      if (!shouldClear) {
        poco.begin(60, 60, poco.width - 120, poco.height - 160)
      }
      poco.fillRectangle(bg, 0, 0, poco.width, poco.height)
      this.renderFace(interval, this.currentContext)
      ;[this.currentContext, this.lastContext] = [this.lastContext, this.currentContext]
    }
    if (shouldClear || shouldRender) {
      poco.end()
    }
    this.renderEffects(interval, this.currentContext)
  }
  clear(color: Color = [0x00, 0x00, 0x00]): void {
    const poco = this._poco
    poco.begin()
    poco.fillRectangle(poco.makeColor(...color), 0, 0, poco.width, poco.height)
    poco.end()
  }
  addEffect(effect: FaceEffect): void {
    this.effects.push(effect)
  }
  removeEffect(effect: FaceEffect): void {
    const idx = this.effects.indexOf(effect)
    if (idx !== -1) {
      this.effects.splice(idx, 1)
      this.removingEffects.push(effect)
    }
  }
  renderFace(tick: number, face: FaceContext, poco: PocoPrototype = this._poco): void {
    poco.clip(40, 60, poco.width - 80, poco.height - 80)
    for (const layer of this.layers) {
      layer.render(tick, poco, face)
    }
    poco.clip()
  }
  renderEffects(tick: number, face: FaceContext, poco: PocoPrototype = this._poco): void {
    for (const renderEffect of this.effects) {
      renderEffect(tick, poco, face)
    }
    for (const removingEffect of this.removingEffects) {
      removingEffect(tick, poco, face, true)
    }
    this.removingEffects.length = 0
  }
}
