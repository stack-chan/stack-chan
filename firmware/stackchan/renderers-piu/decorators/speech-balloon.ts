import { Outline } from 'commodetto/outline'
import type { Container as PiuContainer, Content as PiuContent, Label as PiuLabel, Style as PiuStyle } from 'piu/MC'
import { defaultFaceContext, toColorString, type FaceContext } from 'face-context'

const defaultOptions = {
  left: 16,
  right: 16,
  bottom: 12,
  height: 32,
  padding: 12,
  space: 24,
  radius: 6,
  text: 'Hello from Stack-chan',
  font: '16px Open Sans',
  speed: 60,
}

type BalloonOptions = Partial<typeof defaultOptions> & {
  left?: number
  right?: number
  bottom?: number
  height?: number
}

type WithShape = PiuContent & { fillOutline?: unknown; strokeOutline?: unknown; skin?: unknown }

type LabelBehaviorData = { viewportWidth: number; padding: number; space: number; speed: number }

class BalloonLabelBehavior extends Behavior {
  #speed = 60
  #space = 24
  #padding = 12
  #textWidth = 0
  #viewportWidth = 0
  #x = 0
  onCreate(content: PiuLabel, data: LabelBehaviorData) {
    this.#viewportWidth = data.viewportWidth
    this.#padding = data.padding
    this.#space = data.space
    this.#speed = data.speed
    const size = content.style.measure(content.string)
    this.#textWidth = size.width
    this.#x = content.x
    content.interval = 33
  }
  onTimeChanged(content: PiuLabel) {
    this.#x -= (this.#speed * (content.interval ?? 33)) / 1000
    const resetX = this.#viewportWidth - this.#padding
    const endX = -this.#textWidth - this.#padding - this.#space
    if (this.#x < endX) this.#x = resetX
    content.x = this.#x
  }
}

export function createSpeechBalloonEffect(opts: BalloonOptions = {}): PiuContainer {
  const o = { ...defaultOptions, ...opts }
  const style: PiuStyle = new Style({ font: o.font, color: '#000' })
  let shape: WithShape | null = null
  let label: PiuLabel | null = null
  let currentPrimary: string | null = null
  let currentSecondary: string | null = null

  const container = new Container(null, {
    left: o.left,
    right: o.right,
    bottom: o.bottom,
    height: o.height,
    clip: true,
    Behavior: class extends Behavior {
      ensureParts(self: PiuContainer) {
        if (shape && label) return
        const w = self.width ?? 240
        const h = self.height ?? o.height
        const textSize = style.measure(o.text)
        shape = new Shape(null, { left: 0, top: 0, width: w, height: h }) as WithShape
        const path = Outline.RoundRectPath(0, 0, w, h, o.radius)
        shape.fillOutline = Outline.fill(path)
        shape.strokeOutline = Outline.stroke(path, 2)
        label = new Label(
          { viewportWidth: w - o.padding * 2, padding: o.padding, space: o.space, speed: o.speed },
          {
            left: o.padding,
            top: (h - textSize.height) / 2,
            width: textSize.width,
            height: textSize.height,
            string: o.text,
            style,
            Behavior: BalloonLabelBehavior,
          },
        )
        self.add(shape)
        self.add(label)
      }
      updatePalette(face: FaceContext) {
        if (!shape || !label) return
        const primary = toColorString(face.theme.primary)
        const secondary = toColorString(face.theme.secondary)
        if (primary === currentPrimary && secondary === currentSecondary) return
        currentPrimary = primary
        currentSecondary = secondary
        shape.skin = new Skin({ fill: secondary, stroke: primary })
        label.style = new Style({ font: o.font, color: primary })
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
  })

  return container
}
