import { createFaceState, type FaceState, toPiuColorNumber, toPiuColorString } from 'face-state'
import {
  Container,
  Content,
  type Container as PiuContainer,
  type Content as PiuContent,
  type Skin as PiuSkin,
  type Style as PiuStyle,
  type Text as PiuText,
  type Texture as PiuTexture,
  Skin,
  Style,
  Text,
  Texture,
} from 'piu/MC'

let bubbleTexture: PiuTexture | null = null
let bubbleSkinCache: Map<number, PiuSkin> | null = null
let textStyleCache: Map<string, PiuStyle> | null = null

const defaultOptions = {
  left: 16,
  right: 16,
  bottom: 12,
  minHeight: 44,
  paddingX: 18,
  paddingY: 10,
  text: 'Hello from Stack-chan',
  font: 'k8x12-12',
}

type BalloonOptions = {
  name?: string
  left?: number
  right?: number
  top?: number
  bottom?: number
  width?: number
  height?: number
  minHeight?: number
  padding?: number
  paddingX?: number
  paddingY?: number
  text?: string
  font?: string
  // Legacy options kept for compatibility.
  space?: number
  radius?: number
  speed?: number
}

type WithSkin = PiuContent & { skin?: unknown }
type ResizableContainer = PiuContainer & {
  coordinates?: {
    left?: number
    right?: number
    top?: number
    bottom?: number
    width?: number
    height?: number
  }
}

type BalloonContainerOptions = {
  name?: string
  left?: number
  right?: number
  top?: number
  bottom?: number
  width?: number
  height?: number
  clip: boolean
  Behavior: typeof Behavior
}

function resolveDimension(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback
  return value
}

function getTextStyle(font: string, color: number | string): PiuStyle {
  if (!textStyleCache) textStyleCache = new Map()
  const styleColor = typeof color === 'number' ? toPiuColorString(color) : color
  const key = `${font}:${styleColor}`
  const cached = textStyleCache.get(key)
  if (cached) return cached
  const style = new Style({ font, color: styleColor, horizontal: 'left' })
  textStyleCache.set(key, style)
  return style
}

function getBubbleSkin(color: number): PiuSkin {
  if (!bubbleSkinCache) bubbleSkinCache = new Map()
  const cached = bubbleSkinCache.get(color)
  if (cached) return cached
  if (!bubbleTexture) bubbleTexture = new Texture('bubble.png')
  const skinColor = toPiuColorString(color)
  const skin = new Skin({
    texture: bubbleTexture,
    color: [skinColor],
    x: 0,
    y: 0,
    width: 204,
    height: 332,
    left: 24,
    right: 24,
    top: 12,
    bottom: 12,
  })
  bubbleSkinCache.set(color, skin)
  return skin
}

export const SpeechBalloon = Container.template((opts: BalloonOptions = {}) => {
  const o = { ...defaultOptions, ...opts }
  const paddingX = resolveDimension(opts.paddingX ?? opts.padding, defaultOptions.paddingX)
  const paddingY = resolveDimension(opts.paddingY ?? opts.padding, defaultOptions.paddingY)
  const minHeight = resolveDimension(opts.minHeight, defaultOptions.minHeight)
  const fixedHeight = opts.height

  const style = getTextStyle(o.font, '#000')
  const lineHeight = Math.max(1, style.measure('Mg').height ?? 0)
  let background: WithSkin | null = null
  let bodyText: PiuText | null = null
  let currentText = o.text ?? ''
  let currentPrimary: number | null = null
  let currentSecondary: number | null = null
  let currentFace: FaceState = createFaceState()
  let layoutWidth = 0

  const left = opts.left ?? defaultOptions.left
  const right = opts.right ?? defaultOptions.right
  const top = opts.top
  const bottom = opts.bottom ?? defaultOptions.bottom
  const width = opts.width

  const resolveWidth = (self: PiuContainer) => {
    const w = self.width
    if (w > 0) return w
    if (opts.width !== undefined) return opts.width
    return 240
  }

  const countWrappedLines = (text: string, maxWidth: number) => {
    if (!text || text.length === 0) return 1
    const widthLimit = Math.max(1, maxWidth)
    let lines = 1
    let line = ''
    for (const ch of text) {
      if (ch === '\n') {
        lines += 1
        line = ''
        continue
      }
      const candidate = line + ch
      if ((style.measure(candidate).width ?? 0) <= widthLimit) {
        line = candidate
        continue
      }
      lines += 1
      line = ch
    }
    return lines
  }

  const resolveHeight = (self: PiuContainer, text: string) => {
    if (fixedHeight !== undefined) return fixedHeight
    const availableWidth = resolveWidth(self) - paddingX * 2
    const lines = countWrappedLines(text ?? '', availableWidth)
    return Math.max(minHeight, paddingY * 2 + lineHeight * lines)
  }

  const applyHeight = (self: ResizableContainer, height: number) => {
    const currentHeight = self.coordinates?.height ?? self.height
    if (currentHeight === height) return
    self.coordinates = { ...(self.coordinates ?? {}), height }
  }

  const containerOptions: BalloonContainerOptions = {
    name: opts.name ?? 'SpeechBalloon',
    clip: true,
    Behavior: class extends Behavior {
      ensureParts(self: PiuContainer) {
        const w = resolveWidth(self)
        if (background && bodyText && layoutWidth === w) return
        if (background || bodyText) {
          self.empty()
          background = null
          bodyText = null
        }
        currentPrimary = null
        currentSecondary = null
        layoutWidth = w
        background = new Content(null, { left: 0, right: 0, top: 0, bottom: 0 }) as WithSkin
        bodyText = new Text(null, {
          left: paddingX,
          right: paddingX,
          top: paddingY,
          string: '',
          style,
        })
        self.add(background)
        self.add(bodyText)
        this.updatePalette(currentFace)
        this.updateText(self, currentText)
      }

      updatePalette(face: FaceState) {
        currentFace = face
        if (!background || !bodyText) return
        const primary = toPiuColorNumber(face.theme.primary)
        const secondary = toPiuColorNumber(face.theme.secondary)
        if (primary === currentPrimary && secondary === currentSecondary) return
        currentPrimary = primary
        currentSecondary = secondary
        const bubbleColor = primary
        const textColor = secondary === bubbleColor ? 0x000000 : secondary
        background.skin = getBubbleSkin(bubbleColor)
        bodyText.style = getTextStyle(o.font, textColor)
      }

      updateText(self: PiuContainer, text: string) {
        if (!bodyText) return
        bodyText.string = text ?? ''
        if (fixedHeight === undefined) {
          const nextHeight = resolveHeight(self, text ?? '')
          applyHeight(self as ResizableContainer, nextHeight)
        }
      }

      setText(self: PiuContainer, text: string) {
        currentText = text ?? ''
        this.ensureParts(self)
        this.updateText(self, currentText)
      }

      clear(self: PiuContainer) {
        this.setText(self, '')
      }

      onDisplaying(content: PiuContainer) {
        this.ensureParts(content)
        this.updatePalette(currentFace)
      }

      onFaceState(content: PiuContainer, face: FaceState) {
        this.ensureParts(content)
        this.updatePalette(face)
      }
    },
  }

  if (width !== undefined) {
    containerOptions.width = width
    if (opts.left !== undefined) {
      containerOptions.left = left
    } else if (opts.right !== undefined) {
      containerOptions.right = right
    } else {
      containerOptions.left = left
    }
  } else {
    containerOptions.left = left
    containerOptions.right = right
  }
  if (fixedHeight !== undefined) {
    containerOptions.height = fixedHeight
  }
  if (top !== undefined) {
    containerOptions.top = top
  } else {
    containerOptions.bottom = bottom
  }

  return containerOptions
})

export type { BalloonOptions as SpeechBalloonOptions }
