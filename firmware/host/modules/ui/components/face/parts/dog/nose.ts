import type { FaceSkinPalette } from 'face-skin'
import { DEFAULT_FACE_PRIMARY_COLOR, type FaceState, toPiuColorNumber } from 'face-state'
import { type Port as PiuPort, Port } from 'piu/MC'

export type DogNoseOptions = {
  cx: number
  cy: number
  minHeight?: number
  maxHeight?: number
  canvasWidth?: number
  canvasHeight?: number
}

const CLEAR_COLOR = 'transparent'

function colorString(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`
}

class DogNoseBehavior extends Behavior {
  #cx = 0
  #cy = 0
  #minHeight = 8
  #maxHeight = 24
  #canvasWidth = 320
  #canvasHeight = 200
  #open = 0
  #lastOpen = -1
  #primary = colorString(DEFAULT_FACE_PRIMARY_COLOR)
  #hasPalette = false

  onCreate(port: PiuPort, opts: Required<DogNoseOptions>) {
    this.#cx = opts.cx
    this.#cy = opts.cy
    this.#minHeight = opts.minHeight
    this.#maxHeight = opts.maxHeight
    this.#canvasWidth = opts.canvasWidth
    this.#canvasHeight = opts.canvasHeight
    port.invalidate()
  }

  onFaceSkin(port: PiuPort, palette: FaceSkinPalette) {
    this.#hasPalette = true
    const nextPrimary = colorString(palette.primaryColor)
    if (nextPrimary === this.#primary) return
    this.#primary = nextPrimary
    port.invalidate()
  }

  onFaceState(port: PiuPort, face: FaceState) {
    let needsDraw = false
    if (!this.#hasPalette) {
      const nextPrimary = colorString(toPiuColorNumber(face.theme.primary))
      if (nextPrimary !== this.#primary) {
        this.#primary = nextPrimary
        needsDraw = true
      }
    }
    const open = face.mouth.open
    if (open === this.#lastOpen && !needsDraw) return
    this.#lastOpen = open
    this.#open = open
    port.invalidate()
  }

  onDraw(port: PiuPort) {
    port.fillColor(CLEAR_COLOR, 0, 0, this.#canvasWidth, this.#canvasHeight)
    const h = this.#minHeight + (this.#maxHeight - this.#minHeight) * this.#open
    const y = this.#cy - h / 2
    port.fillColor(this.#primary, Math.round(this.#cx - 8), Math.round(y - 16), 16, Math.round(Math.max(4, h)))
  }
}

export const DogNose = Port.template((opts: DogNoseOptions) => {
  const data = {
    cx: opts.cx,
    cy: opts.cy,
    minHeight: opts.minHeight ?? 8,
    maxHeight: opts.maxHeight ?? 24,
    canvasWidth: opts.canvasWidth ?? 320,
    canvasHeight: opts.canvasHeight ?? 200,
  }
  return {
    left: 0,
    top: 0,
    width: data.canvasWidth,
    height: data.canvasHeight,
    Behavior: class extends DogNoseBehavior {
      onCreate(port: PiuPort) {
        super.onCreate(port, data)
      }
    },
  }
})
