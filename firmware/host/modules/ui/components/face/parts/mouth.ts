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

class MouthBehavior extends Behavior {
  #minWidth = 50
  #maxWidth = 90
  #minHeight = 8
  #maxHeight = 58
  #height = 0
  #primary = DEFAULT_FACE_PRIMARY_COLOR
  #hasPalette = false
  #width = 0
  #x = 0
  #y = 0

  onCreate(port: PiuPort, opts: Required<MouthOptions>) {
    this.#minWidth = opts.minWidth
    this.#maxWidth = opts.maxWidth
    this.#minHeight = opts.minHeight
    this.#maxHeight = opts.maxHeight
    this.updateRect(port, 0, true)
  }

  onFaceSkin(port: PiuPort, palette: FaceSkinPalette) {
    this.#hasPalette = true
    const nextPrimary = palette.primaryColor
    if (nextPrimary === this.#primary) return
    this.#primary = nextPrimary
    port.invalidate(this.#x, this.#y, this.#width, this.#height)
  }

  onFaceState(port: PiuPort, face: FaceState) {
    if (!this.#hasPalette) {
      const nextPrimary = toPiuColorNumber(face.theme.primary)
      if (nextPrimary !== this.#primary) {
        this.#primary = nextPrimary
        port.invalidate(this.#x, this.#y, this.#width, this.#height)
      }
    }
    this.updateRect(port, face.mouth.open)
  }

  onDraw(port: PiuPort, x = 0, y = 0, width = this.#maxWidth, height = this.#maxHeight) {
    const left = Math.max(x, this.#x)
    const top = Math.max(y, this.#y)
    const right = Math.min(x + width, this.#x + this.#width)
    const bottom = Math.min(y + height, this.#y + this.#height)
    if (right > left && bottom > top) {
      port.fillColor(((this.#primary << 8) | 0xff) >>> 0, left, top, right - left, bottom - top)
    }
  }

  private updateRect(port: PiuPort, openValue: number, force = false): void {
    const open = Math.max(0, Math.min(1, openValue))
    const height = Math.round(this.#minHeight + (this.#maxHeight - this.#minHeight) * open)
    const width = Math.round(this.#minWidth + (this.#maxWidth - this.#minWidth) * (1 - open))
    const x = Math.round((this.#maxWidth - width) / 2)
    const y = Math.round((this.#maxHeight - height) / 2)
    if (!force && x === this.#x && y === this.#y && width === this.#width && height === this.#height) return
    if (this.#width > 0 && this.#height > 0) port.invalidate(this.#x, this.#y, this.#width, this.#height)
    this.#x = x
    this.#y = y
    this.#width = width
    this.#height = height
    port.invalidate(x, y, width, height)
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
