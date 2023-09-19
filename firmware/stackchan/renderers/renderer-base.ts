import config from 'mc/config'
import Poco, { PocoPrototype } from 'commodetto/Poco'
import { Outline, CanvasPath } from 'commodetto/outline'
import deepEqual from 'deepEqual'

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

export const defaultFaceContext: Readonly<FaceContext> = {
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
    primary: [0xff, 0xff, 0xff] as Color,
    secondary: [0x00, 0x00, 0x00] as Color,
  },
}

export function createFaceContext(): FaceContext {
  return {
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
      primary: [0xff, 0xff, 0xff] as Color,
      secondary: [0x00, 0x00, 0x00] as Color,
    },
  }
}

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

// Types

export type FaceModifier<T = unknown> = (tick: number, face: FaceContext, arg?: T) => FaceContext
export type FaceModifierFactory<T, V = unknown> = (param: T) => FaceModifier<V>

export type FacePart<T = unknown> = (tick: number, path: CanvasPath, face: Readonly<FaceContext>, arg?: T) => void
export type FacePartFactory<T, V = unknown> = (param: T) => FacePart<V>

export type FaceDecorator<T = unknown> = (
  tick: number,
  poco: PocoPrototype,
  face: Readonly<FaceContext>,
  end?: boolean,
  arg?: T
) => void
export type FaceDecoratorFactory<T, V = unknown> = (param: T) => FaceDecorator<V>

type LayerProps = {
  colorName?: keyof FaceContext['theme']
  type?: 'fill' | 'stroke'
}

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
    const outline =
      this.#type === 'fill'
        ? Outline.fill(path).translate(0, face.breath * 3 ?? 0)
        : Outline.stroke(path, 6).translate(0, face.breath * 3 ?? 0)
    poco.blendOutline(color, 255, outline, 0, 0)
  }
}

export class RendererBase {
  _poco: PocoPrototype

  layers: Layer[]
  filters: FaceModifier[]
  decorators: FaceDecorator[]
  removingDecorators: FaceDecorator[]

  lastContext: FaceContext
  currentContext: FaceContext

  constructor(option?: { poco?: PocoPrototype }) {
    this._poco = option?.poco ?? new Poco(screen, { rotation: config.rotation })
    this.decorators = []
    this.removingDecorators = []
    this.layers = []
    this.lastContext = createFaceContext()
    this.currentContext = createFaceContext()
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
        poco.begin(60, 60, poco.width - 120, poco.height - 120)
      }
      this.renderFace(interval, this.currentContext)
      ;[this.currentContext, this.lastContext] = [this.lastContext, this.currentContext]
    }
    if (shouldClear || shouldRender) {
      poco.end()
    }
    this.renderDecorators(interval, this.currentContext)
  }
  clear(color: Color = [0x00, 0x00, 0x00]): void {
    const poco = this._poco
    poco.begin()
    poco.fillRectangle(poco.makeColor(...color), 0, 0, poco.width, poco.height)
    poco.end()
  }
  addDecorator(decorator: FaceDecorator): void {
    const idx = this.decorators.indexOf(decorator)
    if (idx !== -1) {
      trace('already being added\n')
      return
    }
    this.decorators.push(decorator)
  }
  removeDecorator(decorator: FaceDecorator): void {
    const idx = this.decorators.indexOf(decorator)
    if (idx !== -1) {
      this.decorators.splice(idx, 1)
      this.removingDecorators.push(decorator)
    }
  }
  renderFace(tick: number, face: FaceContext, poco: PocoPrototype = this._poco): void {
    const bg = poco.makeColor(...face.theme.secondary)
    poco.clip(60, 60, poco.width - 120, poco.height - 120)
    poco.fillRectangle(bg, 60, 60, poco.width - 120, poco.height - 120)
    for (const layer of this.layers) {
      layer.render(tick, poco, face)
    }
    poco.clip()
  }
  renderDecorators(tick: number, face: FaceContext, poco: PocoPrototype = this._poco): void {
    for (const removingDecorator of this.removingDecorators) {
      removingDecorator(tick, poco, face, true)
    }
    for (const renderDecorator of this.decorators) {
      renderDecorator(tick, poco, face)
    }
    this.removingDecorators.length = 0
  }
}
