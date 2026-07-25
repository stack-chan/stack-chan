import type { FaceSkinPalette } from 'face-skin'
import { DEFAULT_FACE_PRIMARY_COLOR, type FaceState, toPiuColorNumber, toPiuColorString } from 'face-state'
import { type Port as PiuPort, Port } from 'piu/MC'

export type MouthOptions = {
  cx: number
  cy: number
  minWidth?: number
  maxWidth?: number
  minHeight?: number
  maxHeight?: number
}

const CLEAR_COLOR = 'transparent'
let colorStringCache: Map<number, string> | null = null

function colorString(color: number): string {
  if (!colorStringCache) colorStringCache = new Map()
  const cached = colorStringCache.get(color)
  if (cached) return cached
  const value = toPiuColorString(color)
  colorStringCache.set(color, value)
  return value
}

class MouthBehavior extends Behavior {
  #minWidth = 50
  #maxWidth = 90
  #minHeight = 8
  #maxHeight = 58
  #open = 0
  #lastOpen = -1
  #lastSmile = NaN
  #primary = DEFAULT_FACE_PRIMARY_COLOR
  #hasPalette = false
  #smile = 0

  onCreate(port: PiuPort, opts: Required<MouthOptions>) {
    this.#minWidth = opts.minWidth
    this.#maxWidth = opts.maxWidth
    this.#minHeight = opts.minHeight
    this.#maxHeight = opts.maxHeight
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
    const open = face.mouth.open
    const smile = Math.max(-1, Math.min(1, face.mouth.smile))
    let needsDraw = false
    if (!this.#hasPalette) {
      const nextPrimary = toPiuColorNumber(face.theme.primary)
      if (nextPrimary !== this.#primary) {
        this.#primary = nextPrimary
        needsDraw = true
      }
    }
    if (open === this.#lastOpen && smile === this.#lastSmile && !needsDraw) return
    this.#lastOpen = open
    this.#lastSmile = smile
    this.#open = open
    this.#smile = smile
    port.invalidate()
  }

  onDraw(port: PiuPort) {
    port.fillColor(CLEAR_COLOR, 0, 0, this.#maxWidth, this.#maxHeight)
    const h = this.#minHeight + (this.#maxHeight - this.#minHeight) * this.#open
    const w = this.#minWidth + (this.#maxWidth - this.#minWidth) * (1 - this.#open)
    const x = (this.#maxWidth - w) / 2
    const y = (this.#maxHeight - h) / 2
    const color = colorString(this.#primary)
    const curvature = this.#smile * (1 - this.#open) * 6
    if (Math.abs(curvature) < 0.25) {
      port.fillColor(color, Math.round(x), Math.round(y), Math.round(w), Math.round(h))
      return
    }
    const columns = 11
    const columnWidth = w / columns
    for (let index = 0; index < columns; index += 1) {
      const normalizedX = (index + 0.5) / columns
      const centeredX = normalizedX * 2 - 1
      const offsetY = curvature * (1 - 2 * centeredX * centeredX)
      port.fillColor(
        color,
        Math.round(x + index * columnWidth),
        Math.round(y + offsetY),
        Math.max(1, Math.ceil(columnWidth)),
        Math.round(h),
      )
    }
  }
}

export const Mouth = Port.template((opts: MouthOptions) => {
  const data = {
    cx: opts.cx,
    cy: opts.cy,
    minWidth: opts.minWidth ?? 50,
    maxWidth: opts.maxWidth ?? 90,
    minHeight: opts.minHeight ?? 8,
    maxHeight: opts.maxHeight ?? 58,
  }
  return {
    left: data.cx - data.maxWidth / 2,
    top: data.cy - data.maxHeight / 2,
    width: data.maxWidth,
    height: data.maxHeight,
    Behavior: class extends MouthBehavior {
      onCreate(port: PiuPort) {
        super.onCreate(port, data)
      }
    },
  }
})
