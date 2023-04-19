import config from 'mc/config'
import Poco, { PocoPrototype } from 'commodetto/Poco'
import { Outline, CanvasPath } from 'commodetto/outline'
import deepEqual from 'deepEqual'
import { randomBetween, quantize, normRand } from 'stackchan-util'
import structuredClone from 'structuredClone'

/* global screen */
const INTERVAL = 1000 / 15

// Types

type EyeContext = {
  open: number
  gazeX: number
  gazeY: number
}
type MouthContext = {
  open: number
}

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
    primary: string | number
    secondary: string | number
  }
}

export const defaultFaceContext: FaceContext = Object.freeze({
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
    primary: 'white',
    secondary: 'black',
  }),
} as const)

// Filters

type FaceFilter<T = unknown> = (tick: number, face: FaceContext, arg?: T) => FaceContext
type FaceFilterFactory<T, V = unknown> = (param: T) => FaceFilter<V>

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
      // saccadeX = (Math.random() * 2 - 1) * gain
      // saccadeY = (Math.random() * 2 - 1) * gain
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

export const useDrawEyelid =
  (cx, cy, width, height) => (path: CanvasPath, eyeContext: FaceContext['eyes'][keyof FaceContext['eyes']]) => {
    const w = width
    const h = height * (1 - eyeContext.open)
    const x = cx - width / 2
    const y = cy - height / 2
    path.rect(x, y, w, h)
  }

export const useDrawEye =
  (cx, cy, radius = 8) =>
  (path: CanvasPath, eyeContext: FaceContext['eyes'][keyof FaceContext['eyes']]) => {
    const offsetX = (eyeContext.gazeX ?? 0) * 2
    const offsetY = (eyeContext.gazeY ?? 0) * 2
    path.arc(cx + offsetX, cy + offsetY, radius, 0, 2 * Math.PI)
  }

export const useDrawEyeblow =
  (cx, cy, direction = 1) =>
  (path: CanvasPath, eyeContext: FaceContext['eyes'][keyof FaceContext['eyes']]) => {
    path.ellipse(cx + 8 * direction, cy - 20 - eyeContext.open * 2, 8, 4, (Math.PI / 8) * direction, 0, Math.PI * 2)
  }

export const useDrawMouth =
  (cx, cy, minWidth = 50, maxWidth = 60, minHeight = 8, maxHeight = 24) =>
  (path, mouthContext) => {
    const openRatio = mouthContext.open
    const h = minHeight + (maxHeight - minHeight) * openRatio
    const w = minWidth + (maxWidth - minWidth) * openRatio
    const x = cx - w / 2
    const y = cy - h / 2
    // mouth
    path.moveTo(x, y)
    path.bezierCurveTo(x, y + 20, cx, y + 20, cx, y)
    path.bezierCurveTo(cx, y + 20, x + w, y + 20, x + w, y)

    // nose
    path.moveTo(cx - 8, y - 16)
    path.quadraticCurveTo(cx, y - 18, cx + 8, y - 16)
    path.bezierCurveTo(cx + 6, y - 4, cx - 6, y - 4, cx - 8, y - 16)
    path.closePath()

    if (h > 16) {
      path.moveTo(x + w / 4, y + 16)
      path.bezierCurveTo(x + w / 8, y + h, x + (w * 7) / 8, y + h, x + (w * 3) / 4, y + 16)
    }
    // path.closePath()
  }

// under development
// eslint-disable-next-line @typescript-eslint/no-unused-vars
class Layer {
  #renderers: Array<(path: CanvasPath, context: FaceContext) => unknown>
  constructor() {
    this.#renderers = []
  }
}

type Effect = (poco: PocoPrototype) => void

export class Renderer {
  _poco: PocoPrototype

  drawLeftEye: (path: CanvasPath, context: EyeContext) => unknown
  drawRightEye: (path: CanvasPath, context: EyeContext) => unknown
  drawLeftEyelid: (path: CanvasPath, context: EyeContext) => unknown
  drawRightEyelid: (path: CanvasPath, context: EyeContext) => unknown
  drawLeftEyeblow: (path: CanvasPath, context: EyeContext) => unknown
  drawRightEyeblow: (path: CanvasPath, context: EyeContext) => unknown
  drawMouth: (path: CanvasPath, context: MouthContext) => unknown

  filters: FaceFilter[]
  outline?: Outline
  lastContext: FaceContext
  effects: Effect[]

  background: number
  foreground: number

  constructor(option?: { poco?: PocoPrototype }) {
    this._poco = option?.poco ?? new Poco(screen, { rotation: config.rotation })
    this.background = this._poco.makeColor(0xde, 0xb8, 0x87)
    this.foreground = this._poco.makeColor(0x22, 0x22, 0x22)
    this.drawLeftEye = useDrawEye(90, 93, 12)
    this.drawLeftEyelid = useDrawEyelid(90, 93, 24, 24)
    this.drawLeftEyeblow = useDrawEyeblow(90, 93, 1)
    this.drawRightEye = useDrawEye(230, 96, 12)
    this.drawRightEyelid = useDrawEyelid(230, 96, 24, 24)
    this.drawRightEyeblow = useDrawEyeblow(230, 96, -1)
    this.drawMouth = useDrawMouth(160, 120)

    this.filters = [
      useBlink({ openMin: 400, openMax: 5000, closeMin: 200, closeMax: 400 }),
      useBreath({ duration: 6000 }),
      useSaccade({ updateMin: 300, updateMax: 2000, gain: 0.2 }),
    ]
    this.outline = null
    this.lastContext = null
    this.effects = []
    this.clear()
  }
  update(interval = INTERVAL, faceContext: FaceContext = structuredClone(defaultFaceContext)): void {
    this.filters.forEach((filter) => filter(interval, faceContext))
    if (!deepEqual(faceContext, this.lastContext)) {
      this.render(faceContext)
    }
    this.lastContext = faceContext
  }
  clear(): void {
    const poco = this._poco
    poco.begin()
    poco.fillRectangle(this.background, 0, 0, poco.width, poco.height)
    poco.end()
  }
  addEffect(effect: Effect): void {
    this.effects.push(effect)
  }
  removeEffect(effect: Effect): void {
    const idx = this.effects.indexOf(effect)
    if (idx !== -1) {
      this.effects.splice(idx, 1)
    }
  }
  render(faceContext: FaceContext, poco: PocoPrototype = this._poco): void {
    poco.begin(40, 60, poco.width - 80, poco.height - 40)
    poco.fillRectangle(this.background, 0, 0, poco.width, poco.height)

    const layer1 = new Outline.CanvasPath()
    this.drawLeftEye(layer1, faceContext.eyes.left)
    this.drawRightEye(layer1, faceContext.eyes.right)
    this.drawLeftEyeblow(layer1, faceContext.eyes.left)
    this.drawRightEyeblow(layer1, faceContext.eyes.right)
    let outline = Outline.fill(layer1, Outline.EVEN_ODD_RULE).translate(0, faceContext.breath * 3 ?? 0)
    // let outline = Outline.stroke(layer1, 6)
    poco.blendOutline(this.foreground, 255, outline, 0, 0)

    const layer3 = new Outline.CanvasPath()
    this.drawMouth(layer3, faceContext.mouth)
    outline = Outline.stroke(layer3, 6).translate(0, faceContext.breath * 3 ?? 0)
    poco.blendOutline(this.foreground, 255, outline, 0, 0)

    // const layer2 = new Outline.CanvasPath()
    // this.drawLeftEyelid(layer2, faceContext.eyes.left)
    // this.drawRightEyelid(layer2, faceContext.eyes.right)
    // outline = Outline.fill(layer2, Outline.EVEN_ODD_RULE).translate(0, faceContext.breath * 3 ?? 0)
    // poco.blendOutline(this.background, 255, outline, 0, 0)

    for (const renderEffect of this.effects) {
      renderEffect(this._poco)
    }

    poco.end()
  }
}
