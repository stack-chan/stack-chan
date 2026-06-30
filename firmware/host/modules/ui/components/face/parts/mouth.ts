import type { FaceSkinPalette } from 'face-skin'
import { DEFAULT_FACE_PRIMARY_COLOR, type FaceState, toPiuColorNumber } from 'face-state'
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
  const value = `#${color.toString(16).padStart(6, '0')}`
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
  #primary = DEFAULT_FACE_PRIMARY_COLOR
  #hasPalette = false

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
    let needsDraw = false
    if (!this.#hasPalette) {
      const nextPrimary = toPiuColorNumber(face.theme.primary)
      if (nextPrimary !== this.#primary) {
        this.#primary = nextPrimary
        needsDraw = true
      }
    }
    if (open === this.#lastOpen && !needsDraw) return
    this.#lastOpen = open
    this.#open = open
    port.invalidate()
  }

  onDraw(port: PiuPort) {
    port.fillColor(CLEAR_COLOR, 0, 0, this.#maxWidth, this.#maxHeight)
    const h = this.#minHeight + (this.#maxHeight - this.#minHeight) * this.#open
    const w = this.#minWidth + (this.#maxWidth - this.#minWidth) * (1 - this.#open)
    port.fillColor(
      colorString(this.#primary),
      Math.round((this.#maxWidth - w) / 2),
      Math.round((this.#maxHeight - h) / 2),
      Math.round(w),
      Math.round(h),
    )
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
