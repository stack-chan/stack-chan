import type {
  Container as PiuContainer,
  Content as PiuContent,
  Style as PiuStyle,
  Text as PiuText,
  Texture as PiuTexture,
} from 'piu/MC'
import { defaultFaceContext, type FaceContext } from 'face-context'

let bubbleTexture: PiuTexture | null = null

const defaultOptions = {
  left: 16,
  right: 16,
  bottom: 12,
  minHeight: 32,
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

export const SpeechBalloon = Container.template((opts: BalloonOptions = {}) => {
  const o = { ...defaultOptions, ...opts }
  const paddingX = resolveDimension(opts.paddingX ?? opts.padding, defaultOptions.paddingX)
  const paddingY = resolveDimension(opts.paddingY ?? opts.padding, defaultOptions.paddingY)
  const minHeight = resolveDimension(opts.minHeight, defaultOptions.minHeight)
  const fixedHeight = opts.height

  const style: PiuStyle = new Style({ font: o.font, color: '#000', horizontal: 'left' })
  const lineHeight = Math.max(1, style.measure('Mg').height)
  let background: WithSkin | null = null
  let bodyText: PiuText | null = null
  let currentText = o.text ?? ''
  let currentPrimary: string | null = null
  let currentSecondary: string | null = null
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
      if (style.measure(candidate).width <= widthLimit) {
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
        this.updatePalette(defaultFaceContext)
        this.updateText(self, currentText)
      }

      updatePalette(face: FaceContext) {
        if (!background || !bodyText) return
        if (!bubbleTexture) bubbleTexture = new Texture('bubble.png')
        const primary = face.theme.primary
        const secondary = face.theme.secondary
        if (primary === currentPrimary && secondary === currentSecondary) return
        currentPrimary = primary
        currentSecondary = secondary
        const bubbleColor = primary
        const textColor = secondary === bubbleColor ? '#000000' : secondary
        background.skin = new Skin({
          texture: bubbleTexture,
          color: [bubbleColor],
          x: 0,
          y: 0,
          width: 204,
          height: 332,
          left: 24,
          right: 24,
          top: 12,
          bottom: 12,
        })
        bodyText.style = new Style({ font: o.font, color: textColor, horizontal: 'left' })
      }

      updateText(self: PiuContainer, text: string) {
        if (!bodyText) return
        bodyText.string = text ?? ''
        if (fixedHeight === undefined) {
          const nextHeight = resolveHeight(self, text ?? '')
          if (self.height !== nextHeight) self.height = nextHeight
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
        this.updatePalette(defaultFaceContext)
      }

      onFaceContext(content: PiuContainer, face: FaceContext) {
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
