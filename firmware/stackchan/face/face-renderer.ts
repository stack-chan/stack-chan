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
  mouth: {
    open: 0,
  },
  eyes: {
    left: {
      open: 1,
      gazeX: 0,
      gazeY: 0,
    },
    right: {
      open: 1,
      gazeX: 0,
      gazeY: 0,
    },
  },
  breath: 1,
  emotion: Emotion.NEUTRAL,
  theme: {
    primary: 'white',
    secondary: 'black',
  },
})

// Filters

type FaceFilter<T = unknown> = (tick: number, face: FaceContext, arg?: T) => FaceContext
type FaceFilterFactory<T, V = unknown> = (T) => FaceFilter<V>

export const useBlink: FaceFilterFactory<{ openMin: number, openMax: number, closeMin: number, closeMax: number }> = ({ openMin, openMax, closeMin, closeMax }) => {
  let isBlinking = false
  let nextToggle = randomBetween(openMin, openMax)
  let count = 0
  return (tickMillis: number, face: FaceContext) => {
    const eyeOpen = isBlinking ? 1 - Math.sin((count / nextToggle) * Math.PI) : 1
    count += tickMillis
    if (count >= nextToggle) {
      isBlinking = !isBlinking
      count = 0
      nextToggle = isBlinking ? randomBetween(closeMin, closeMax) : randomBetween(openMin, openMax)
    }
    Object.values(face.eyes).map(eye => {
      eye.open *= eyeOpen
    })
    return face
  }
}

export const useSaccade: FaceFilterFactory<{ updateMin: number, updateMax: number, gain: number }> = ({ updateMin, updateMax, gain }) => {
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
    Object.values(face.eyes).map(eye => {
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

export const useDrawEyelid = (cx, cy, width, height) => (path: CanvasPath, eyeContext: FaceContext['eyes'][keyof FaceContext['eyes']]) => {
  const w = width
  const h = height * (1 - eyeContext.open)
  const x = cx - width / 2
  const y = cy - height / 2
  path.rect(x, y, w, h)
}

export const useDrawEye =
  (cx, cy, radius = 8) =>
    (path: CanvasPath, eyeContext: FaceContext['eyes'][keyof FaceContext['eyes']]) => {
      const openRatio = eyeContext.open
      const offsetX = (eyeContext.gazeX ?? 0) * 2
      const offsetY = (eyeContext.gazeY ?? 0) * 2
      path.arc(cx + offsetX, cy + offsetY, radius, 0, 2 * Math.PI)
    }

export const useDrawMouth =
  (cx, cy, minWidth = 50, maxWidth = 90, minHeight = 8, maxHeight = 58) =>
    (path, mouthContext) => {
      const openRatio = mouthContext.open
      const h = minHeight + (maxHeight - minHeight) * openRatio
      const w = minWidth + (maxWidth - minWidth) * (1 - openRatio)
      const x = cx - w / 2
      const y = cy - h / 2
      path.rect(x, y, w, h)
    }

class Layer {
  #renderers: Array<(path: CanvasPath, context: FaceContext) => unknown>
  constructor() {
    this.#renderers = []
  }
}

export class Renderer {
  _poco: PocoPrototype

  drawLeftEye: (path: CanvasPath, context: EyeContext) => unknown
  drawRightEye: (path: CanvasPath, context: EyeContext) => unknown
  drawLeftEyelid: (path: CanvasPath, context: EyeContext) => unknown
  drawRightEyelid: (path: CanvasPath, context: EyeContext) => unknown
  drawMouth: (path: CanvasPath, context: MouthContext) => unknown

  filters: FaceFilter[]
  outline?: Outline
  lastContext: FaceContext

  background: number
  foreground: number

  constructor() {
    this._poco = new Poco(screen, { rotation: 90 })
    this.background = this._poco.makeColor(0, 0, 0)
    this.foreground = this._poco.makeColor(255, 255, 255)
    this.drawLeftEye = useDrawEye(90, 93, 8)
    this.drawLeftEyelid = useDrawEyelid(90, 93, 24, 24)
    this.drawRightEye = useDrawEye(230, 96, 8)
    this.drawRightEyelid = useDrawEyelid(230, 96, 24, 24)
    this.drawMouth = useDrawMouth(160, 148)

    this.filters = [
      useBlink({ openMin: 400, openMax: 5000, closeMin: 300, closeMax: 600 }),
      useBreath({ duration: 6000 }),
      useSaccade({ updateMin: 300, updateMax: 2000, gain: 0.2 }),
    ]
    this.outline = null
    this.lastContext = null
    this.clear()
  }
  update(interval = INTERVAL, faceContext: FaceContext = structuredClone(defaultFaceContext)): void {
    this.filters.forEach(filter => filter(interval, faceContext))
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
  render(faceContext: FaceContext, poco: PocoPrototype = this._poco): void {
    try {
    poco.begin(40, 80, poco.width - 80, poco.height - 80)
    poco.fillRectangle(this.background, 0, 0, poco.width, poco.height)

    const layer1 = new Outline.CanvasPath()
    this.drawLeftEye(layer1, faceContext.eyes.left)
    this.drawRightEye(layer1, faceContext.eyes.right)
    this.drawMouth(layer1, faceContext.mouth)
    let outline = Outline.fill(layer1).translate(0, faceContext.breath * 3 ?? 0)
    poco.blendOutline(this.foreground, 255, outline, 0, 0)

    const layer2 = new Outline.CanvasPath()
    this.drawLeftEyelid(layer2, faceContext.eyes.left)
    this.drawRightEyelid(layer2, faceContext.eyes.right)
    outline = Outline.fill(layer2, Outline.EVEN_ODD_RULE).translate(0, faceContext.breath * 3 ?? 0)
    poco.blendOutline(this.background, 255, outline, 0, 0)
    poco.end()
    } catch (e) {
      debugger
    }
  }
}
