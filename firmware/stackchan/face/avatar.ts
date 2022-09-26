import Poco, { PocoPrototype } from 'commodetto/Poco'
import { Outline, CanvasPath } from 'commodetto/outline'
import deepEqual from 'deepEqual'

/* global screen */
const INTERVAL = 1000 / 15

const Emotion = Object.freeze({
  NEUTRAL: 'NEUTRAL',
  ANGRY: 'ANGRY',
  SAD: 'SAD',
  HAPPY: 'HAPPY',
  SLEEPY: 'SLEEPY',
  DOUBTFUL: 'DOUBTFUL',
  COLD: 'COLD',
  HOT: 'HOT',
})
type Emotion = typeof Emotion[keyof typeof Emotion]

function normRand(m: number, s: number): number {
  const a = 1 - Math.random()
  const b = 1 - Math.random()
  const c = Math.sqrt(-2 * Math.log(a))
  if (0.5 - Math.random() > 0) {
    return c * Math.sin(Math.PI * 2 * b) * s + m
  } else {
    return c * Math.cos(Math.PI * 2 * b) * s + m
  }
}

function randomBetween(min, max) {
  return min + (max - min) * Math.random()
}

function quantize(value, divider) {
  return Math.ceil(value * divider) / divider
}

const useBlink = (openMin, openMax, closeMin, closeMax) => {
  let isBlinking = false
  let nextToggle = randomBetween(openMin, openMax)
  let count = 0
  return (tickMillis) => {
    const eyeOpen = isBlinking ? quantize(1 - Math.sin((count / nextToggle) * Math.PI), 8) : 1
    count += tickMillis
    if (count >= nextToggle) {
      isBlinking = !isBlinking
      count = 0
      nextToggle = isBlinking ? randomBetween(closeMin, closeMax) : randomBetween(openMin, openMax)
    }
    return eyeOpen
  }
}

const useSaccade: (updateMin: number, updateMax: number, gain: number) => (number) => [number, number] = (
  updateMin: number,
  updateMax: number,
  gain: number
) => {
  let nextToggle = randomBetween(updateMin, updateMax)
  let saccadeX = 0
  let saccadeY = 0
  return (tickMillis) => {
    nextToggle -= tickMillis
    if (nextToggle < 0) {
      saccadeX = (Math.random() * 2 - 1) * gain
      saccadeY = (Math.random() * 2 - 1) * gain
      nextToggle = randomBetween(updateMin, updateMax)
    }
    return [saccadeX, saccadeY]
  }
}

const useBreath = (duration) => {
  let time = 0
  return (tickMillis, emotion = Emotion.NEUTRAL) => {
    time += tickMillis % duration
    return quantize(Math.sin((2 * Math.PI * time) / duration), 8)
  }
}

const useDrawEyelid = (cx, cy, width, height) => (path, eyeContext) => {
  const w = width
  const h = height * (1 - eyeContext.open)
  const x = cx - width / 2
  const y = cy - height / 2
  path.rect(x, y, w, h)
}

const useDrawEye =
  (cx, cy, radius = 8) =>
  (path, eyeContext) => {
    const openRatio = eyeContext.open
    const offsetX = (eyeContext.gazeX ?? 0) * 2
    const offsetY = (eyeContext.gazeY ?? 0) * 2
    if (openRatio < 0.3) {
      // closed
      const w = radius * 2
      const h = Math.min(4, radius / 2)
      const x = cx - w / 2
      const y = cy - h / 2
      path.rect(x, y, w, h)
    } else {
      // open
      path.arc(cx + offsetX, cy + offsetY, radius, 0, 2 * Math.PI)
    }
  }

const useDrawMouth =
  (cx, cy, minWidth = 50, maxWidth = 90, minHeight = 8, maxHeight = 58) =>
  (path, mouthContext) => {
    const openRatio = mouthContext.open
    const h = minHeight + (maxHeight - minHeight) * openRatio
    const w = minWidth + (maxWidth - minWidth) * (1 - openRatio)
    const x = cx - w / 2
    const y = cy - h / 2
    path.rect(x, y, w, h)
  }

type FaceContext = {
  mouth: {
    open: number
  }
  eyes: {
    left: {
      open: number
      gazeX: number
      gazeY: number
    }
    right: {
      open: number
      gazeX: number
      gazeY: number
    }
  }
  breath: number
  emotion: Emotion
  theme: {
    primary: string | number
    secondary: string | number
  }
}

class Renderer {
  #poco: PocoPrototype

  drawLeftEye: (path: CanvasPath, context: FaceContext['eyes']['left']) => unknown
  drawRightEye: (path: CanvasPath, context: FaceContext['eyes']['right']) => unknown
  drawLeftEyelid: (path: CanvasPath, context: FaceContext['eyes']['left']) => unknown
  drawRightEyelid: (path: CanvasPath, context: FaceContext['eyes']['right']) => unknown
  drawMouth: (path: CanvasPath, context: FaceContext['mouth']) => unknown

  updateBlink: (interval: number) => number
  updateBreath: (interval: number) => number
  updateSaccade: (interval: number) => [number, number]
  outline?: Outline
  lastContext: FaceContext

  background: number
  foreground: number

  constructor() {
    this.#poco = new Poco(screen, { rotation: 90 })
    this.background = this.#poco.makeColor(0, 0, 0)
    this.foreground = this.#poco.makeColor(0, 255, 0)
    this.drawLeftEye = useDrawEye(90, 93, 8)
    this.drawLeftEyelid = useDrawEyelid(90, 93, 24, 24)
    this.drawRightEye = useDrawEye(230, 96, 8)
    this.drawRightEyelid = useDrawEyelid(230, 96, 24, 24)
    this.drawMouth = useDrawMouth(160, 148)

    this.updateBlink = useBlink(400, 5000, 200, 400)
    this.updateBreath = useBreath(6000)
    this.updateSaccade = useSaccade(300, 2000, 1.0)
    this.outline = null
    this.lastContext = null
  }
  update(interval = INTERVAL): unknown {
    const eyeOpen = this.updateBlink(interval)
    const breath = this.updateBreath(interval)
    const [saccadeX, saccadeY] = this.updateSaccade(interval)
    const faceContext = {
      mouth: {
        open: 0,
      },
      eyes: {
        left: {
          open: eyeOpen,
          gazeX: saccadeX,
          gazeY: saccadeY,
        },
        right: {
          open: eyeOpen,
          gazeX: saccadeX,
          gazeY: saccadeY,
        },
      },
      breath,
      emotion: Emotion.NEUTRAL,
      theme: {
        primary: 'white',
        secondary: 'black',
      },
    }
    if (deepEqual(this.lastContext, faceContext)) {
      return
    }
    this.render(this.#poco, faceContext)
    this.lastContext = faceContext
  }
  clear(): void {
    const poco = this.#poco
    poco.begin()
    poco.fillRectangle(this.background, 0, 0, poco.width, poco.height)
    poco.end()
  }
  render(poco: PocoPrototype, faceContext: FaceContext): void {
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
  }
}

export default Renderer
