import { Outline } from 'commodetto/outline'
import { defaultFaceContext, type FaceContext } from 'face-context'
import type { Container as PiuContainer, Content as PiuContent, Style as PiuStyle, Text as PiuText } from 'piu/MC'
import type { Shape as PiuShape } from 'piu/shape'

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

type WithShape = PiuContent &
  Omit<PiuShape, 'fillOutline' | 'strokeOutline'> & { fillOutline?: unknown; strokeOutline?: unknown; skin?: unknown }
type BodyText = PiuText

export const MultiRowBalloon = Container.template((opts: MultiRowBalloonOptions = {}) => {
  const o = { ...defaultOptions, ...opts }
  let shape: WithShape | null = null
  let bodyText: BodyText | null = null
  let currentPrimary: string | null = null
  let currentSecondary: string | null = null
  let currentText = o.text ?? ''
  let layoutWidth = 0
  let layoutHeight = 0
  const left = opts.left ?? defaultOptions.left
  const right = opts.right ?? defaultOptions.right
  const top = opts.top
  const bottom = opts.bottom ?? defaultOptions.bottom
  const width = opts.width
  const style: PiuStyle = new Style({ font: o.font, color: '#000', horizontal: 'left' })

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
        if (shape && bodyText && layoutWidth === w && layoutHeight === h) return
        if (shape || bodyText) {
          self.empty()
          shape = null
          bodyText = null
        }
        layoutWidth = w
        layoutHeight = h
        shape = new Shape(null, { left: 0, top: 0, width: w, height: h }) as WithShape
        const path = Outline.RoundRectPath(0, 0, w, h, o.radius)
        shape.fillOutline = Outline.fill(path)
        shape.strokeOutline = Outline.stroke(path, 2)
        bodyText = new Text(null, {
          left: o.paddingX,
          right: o.paddingX,
          top: o.paddingY,
          bottom: o.paddingY,
          string: '',
          style,
        })
        self.add(shape)
        self.add(bodyText)
        this.updateText(self, currentText)
      }

      updatePalette(face: FaceContext) {
        if (!shape || !bodyText) return
        const primary = face.theme.primary
        const secondary = face.theme.secondary
        if (primary === currentPrimary && secondary === currentSecondary) return
        currentPrimary = primary
        currentSecondary = secondary
        shape.skin = new Skin({ fill: secondary, stroke: primary })
        const nextStyle = new Style({ font: o.font, color: primary, horizontal: 'left' })
        bodyText.style = nextStyle
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

  if (top !== undefined) {
    containerOptions.top = top
  } else {
    containerOptions.bottom = bottom
  }

  return containerOptions
})

export type { MultiRowBalloonOptions }
