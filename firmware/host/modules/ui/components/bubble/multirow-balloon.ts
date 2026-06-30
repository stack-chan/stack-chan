import { createFaceState, type FaceState, toPiuColorNumber } from 'face-state'
import {
  type Container as PiuContainer,
  type Content as PiuContent,
  type Port as PiuPort,
  type Style as PiuStyle,
  type Text as PiuText,
  Port,
} from 'piu/MC'

const defaultOptions = {
  left: 0,
  right: 0,
  bottom: 4,
  height: 28,
  paddingX: 4,
  paddingY: 2,
  radius: 6,
  text: '',
  font: 'k8x12-12',
  charWidth: 8,
  lineHeight: 12,
}

const CLEAR_COLOR = 'transparent'
let textStyleCache: Map<string, PiuStyle> | null = null

type MultiRowBalloonOptions = {
  name?: string
  left?: number
  right?: number
  top?: number
  bottom?: number
  width?: number
  height?: number
  paddingX?: number
  paddingY?: number
  radius?: number
  text?: string
  font?: string
  charWidth?: number
  lineHeight?: number
}

type BodyText = PiuText

function colorString(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`
}

function getTextStyle(font: string, color: number | string): PiuStyle {
  if (!textStyleCache) textStyleCache = new Map()
  const key = `${font}:${color}`
  const cached = textStyleCache.get(key)
  if (cached) return cached
  const style = new Style({ font, color, horizontal: 'left' })
  textStyleCache.set(key, style)
  return style
}

export const MultiRowBalloon = Container.template((opts: MultiRowBalloonOptions = {}) => {
  const o = { ...defaultOptions, ...opts }
  let background: PiuPort | null = null
  let bodyText: BodyText | null = null
  let currentPrimary: number | null = null
  let currentSecondary: number | null = null
  let currentText = o.text ?? ''
  let layoutWidth = 0
  let layoutHeight = 0
  const left = opts.left ?? defaultOptions.left
  const right = opts.right ?? defaultOptions.right
  const top = opts.top
  const bottom = opts.bottom ?? defaultOptions.bottom
  const width = opts.width
  const style = getTextStyle(o.font, '#000')

  const resolveWidth = (self: PiuContainer) => {
    const w = self.width
    return w > 0 ? w : 320
  }

  const resolveHeight = (self: PiuContainer) => {
    const h = self.height
    return h > 0 ? h : o.height
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

  const containerOptions: BalloonContainerOptions = {
    name: opts.name ?? 'MultiRowBalloon',
    height: o.height,
    clip: true,
    Behavior: class extends Behavior {
      ensureParts(self: PiuContainer) {
        const w = resolveWidth(self)
        const h = resolveHeight(self)
        if (background && bodyText && layoutWidth === w && layoutHeight === h) return
        if (background || bodyText) {
          self.empty()
          background = null
          bodyText = null
        }
        layoutWidth = w
        layoutHeight = h
        background = new Port(null, {
          left: 0,
          top: 0,
          width: w,
          height: h,
          Behavior: class extends Behavior {
            onDraw(port: PiuPort) {
              port.fillColor(CLEAR_COLOR, 0, 0, w, h)
              const primary = currentPrimary ?? 0xffffff
              const secondary = currentSecondary ?? 0x000000
              const stroke = 2
              port.fillColor(colorString(secondary), 0, 0, w, h)
              port.fillColor(colorString(primary), 0, 0, w, stroke)
              port.fillColor(colorString(primary), 0, h - stroke, w, stroke)
              port.fillColor(colorString(primary), 0, 0, stroke, h)
              port.fillColor(colorString(primary), w - stroke, 0, stroke, h)
            }
          },
        }) as PiuPort
        bodyText = new Text(null, {
          left: o.paddingX,
          right: o.paddingX,
          top: o.paddingY,
          bottom: o.paddingY,
          string: '',
          style,
        })
        self.add(background as unknown as PiuContent)
        self.add(bodyText)
        this.updateText(self, currentText)
      }

      updatePalette(face: FaceState) {
        if (!background || !bodyText) return
        const primary = toPiuColorNumber(face.theme.primary)
        const secondary = toPiuColorNumber(face.theme.secondary)
        if (primary === currentPrimary && secondary === currentSecondary) return
        currentPrimary = primary
        currentSecondary = secondary
        bodyText.style = getTextStyle(o.font, primary)
        background.invalidate()
      }

      updateText(_self: PiuContainer, text: string) {
        if (!bodyText) return
        bodyText.string = text ?? ''
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
        this.updatePalette(createFaceState())
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

  if (top !== undefined) {
    containerOptions.top = top
  } else {
    containerOptions.bottom = bottom
  }

  return containerOptions
})

export type { MultiRowBalloonOptions }
