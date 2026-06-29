import type { FaceSkinPalette } from 'face-skin'
import { DEFAULT_FACE_PRIMARY_COLOR, Emotion, type FaceEyeKey, type FaceState, toPiuColorNumber } from 'face-state'
import { type Port as PiuPort, Port } from 'piu/MC'

export type EyebrowOptions = {
  cx: number
  cy: number
  side: FaceEyeKey
  canvasWidth?: number
  canvasHeight?: number
}

const CLEAR_COLOR = 'transparent'
const colorStringCache = new Map<number, string>()

function colorString(color: number): string {
  const cached = colorStringCache.get(color)
  if (cached) return cached
  const value = `#${color.toString(16).padStart(6, '0')}`
  colorStringCache.set(color, value)
  return value
}

class DogEyebrowBehavior extends Behavior {
  #cx = 0
  #cy = 0
  #side: FaceEyeKey = 'left'
  #direction = 1
  #canvasWidth = 320
  #canvasHeight = 120
  #eyeOpen = 1
  #emotion: FaceState['emotion'] = Emotion.NEUTRAL
  #lastKey = ''
  #primary = DEFAULT_FACE_PRIMARY_COLOR
  #hasPalette = false

  onCreate(port: PiuPort, opts: Required<EyebrowOptions>) {
    this.#cx = opts.cx
    this.#cy = opts.cy
    this.#side = opts.side
    this.#direction = opts.side === 'left' ? 1 : -1
    this.#canvasWidth = opts.canvasWidth
    this.#canvasHeight = opts.canvasHeight
    port.invalidate()
  }

  onFaceSkin(port: PiuPort, palette: FaceSkinPalette) {
    this.#hasPalette = true
    const nextPrimary = palette.primaryColor
    if (nextPrimary === this.#primary) return
    this.#primary = nextPrimary
    port.invalidate()
  }

  onFaceState(port: PiuPort, face: FaceState) {
    let needsDraw = false
    if (!this.#hasPalette) {
      const nextPrimary = toPiuColorNumber(face.theme.primary)
      if (nextPrimary !== this.#primary) {
        this.#primary = nextPrimary
        needsDraw = true
      }
    }
    const eye = face.eyes[this.#side]
    const key = `${eye.open.toFixed(3)}:${face.emotion}`
    if (key === this.#lastKey && !needsDraw) return
    this.#lastKey = key
    this.#eyeOpen = eye.open
    this.#emotion = face.emotion
    port.invalidate()
  }

  onDraw(port: PiuPort) {
    port.fillColor(CLEAR_COLOR, 0, 0, this.#canvasWidth, this.#canvasHeight)
    let direction = this.#direction
    if (this.#emotion === Emotion.ANGRY) direction *= 1.2
    else if (this.#emotion === Emotion.SAD) direction *= -1
    const width = Math.round(20 + Math.abs(direction) * 4)
    const height = this.#emotion === Emotion.SLEEPY ? 4 : 6
    const x = this.#cx + 8 * this.#direction - width / 2
    const y = this.#cy - 20 - this.#eyeOpen * 2 + (direction < 0 ? 4 : 0)
    port.fillColor(colorString(this.#primary), Math.round(x), Math.round(y), width, height)
  }
}

export const DogEyebrow = Port.template((opts: EyebrowOptions) => {
  const data = {
    cx: opts.cx,
    cy: opts.cy,
    side: opts.side,
    canvasWidth: opts.canvasWidth ?? 320,
    canvasHeight: opts.canvasHeight ?? 120,
  }
  return {
    left: 0,
    top: 0,
    width: data.canvasWidth,
    height: data.canvasHeight,
    Behavior: class extends DogEyebrowBehavior {
      onCreate(port: PiuPort) {
        super.onCreate(port, data)
      }
    },
  }
})
