import type { FaceSkinPalette } from 'face-skin'
import {
  DEFAULT_FACE_PRIMARY_COLOR,
  DEFAULT_FACE_SECONDARY_COLOR,
  type FaceEyeKey,
  type FaceState,
  toPiuColorNumber,
} from 'face-state'
import { createEyelidAperture, type EyelidAperture, writeEyelidAperture } from 'parts/eyelid-geometry'
import { Gray16Mask } from 'parts/gray16-mask'
import Gray16MaskPort from 'parts/gray16-mask-port'
import type { Port as PiuPort } from 'piu/MC'

export type EyeShape = 'circle' | 'roundRect'

export type EyeOptions = {
  cx: number
  cy: number
  shape?: EyeShape
  radius?: number
  width?: number
  height?: number
  r?: number
  side: FaceEyeKey
  eyelidWidth?: number
  eyelidHeight?: number
}

type MaskPort = PiuPort & {
  drawGray: (mask: Gray16Mask, color: number) => void
}

type Rect = {
  x: number
  y: number
  width: number
  height: number
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}

function quantizeEdge(value: number): number {
  return Math.round(value * 16) / 16
}

function apertureChanged(left: Readonly<EyelidAperture>, right: Readonly<EyelidAperture>): boolean {
  return (
    left.topLeft !== right.topLeft ||
    left.topRight !== right.topRight ||
    left.bottomLeft !== right.bottomLeft ||
    left.bottomRight !== right.bottomRight
  )
}

function copyAperture(src: Readonly<EyelidAperture>, dst: EyelidAperture): void {
  dst.topLeft = src.topLeft
  dst.topRight = src.topRight
  dst.bottomLeft = src.bottomLeft
  dst.bottomRight = src.bottomRight
}

function quantizeAperture(aperture: EyelidAperture): void {
  aperture.topLeft = quantizeEdge(aperture.topLeft)
  aperture.topRight = quantizeEdge(aperture.topRight)
  aperture.bottomLeft = quantizeEdge(aperture.bottomLeft)
  aperture.bottomRight = quantizeEdge(aperture.bottomRight)
}

function invalidateRect(port: PiuPort, rect: Readonly<Rect>, limitWidth: number, limitHeight: number): void {
  const x = Math.max(0, Math.floor(rect.x - 1))
  const y = Math.max(0, Math.floor(rect.y - 1))
  const right = Math.min(limitWidth, Math.ceil(rect.x + rect.width + 1))
  const bottom = Math.min(limitHeight, Math.ceil(rect.y + rect.height + 1))
  if (right > x && bottom > y) port.invalidate(x, y, right - x, bottom - y)
}

function writeIrisRect(
  rect: Rect,
  baseLeft: number,
  baseTop: number,
  width: number,
  height: number,
  gazeX: number,
  gazeY: number,
): void {
  rect.x = baseLeft + gazeX
  rect.y = baseTop + gazeY
  rect.width = width
  rect.height = height
}

function fillIrisMask(mask: Gray16Mask, shape: EyeShape, rect: Readonly<Rect>, radius: number): void {
  mask.clear()
  if (shape === 'roundRect') {
    mask.fillRoundRect(rect.x, rect.y, rect.width, rect.height, radius)
  } else {
    mask.fillCircle(rect.x + rect.width / 2, rect.y + rect.height / 2, radius)
  }
}

function invalidateApertureChange(
  port: PiuPort,
  previous: Readonly<EyelidAperture>,
  next: Readonly<EyelidAperture>,
  width: number,
  height: number,
): void {
  const topMin = Math.min(previous.topLeft, previous.topRight, next.topLeft, next.topRight)
  const topMax = Math.max(previous.topLeft, previous.topRight, next.topLeft, next.topRight)
  const bottomMin = Math.min(previous.bottomLeft, previous.bottomRight, next.bottomLeft, next.bottomRight)
  const bottomMax = Math.max(previous.bottomLeft, previous.bottomRight, next.bottomLeft, next.bottomRight)
  const topY = Math.max(0, Math.floor(topMin) - 1)
  const topBottom = Math.min(height, Math.ceil(topMax) + 1)
  if (topBottom > topY) port.invalidate(0, topY, width, topBottom - topY)
  if (bottomMin < height || bottomMax < height) {
    const y = Math.max(0, Math.floor(bottomMin) - 1)
    port.invalidate(0, y, width, Math.min(height - y, Math.ceil(bottomMax) - y + 1))
  }
}

export const Eye = Container.template((opts: EyeOptions) => {
  const shape = opts.shape ?? 'circle'
  const radius = opts.radius ?? 8
  const diameter = radius * 2
  const irisWidth = shape === 'roundRect' ? Math.max(2, opts.width ?? 16) : diameter
  const irisHeight = shape === 'roundRect' ? Math.max(2, opts.height ?? 16) : diameter
  const irisRadius = shape === 'roundRect' ? Math.max(0, Math.min(opts.r ?? 4, irisWidth / 2, irisHeight / 2)) : radius
  const eyelidWidth = opts.eyelidWidth ?? (shape === 'circle' ? radius * 3 : irisWidth)
  const eyelidHeight = opts.eyelidHeight ?? (shape === 'circle' ? radius * 3 : irisHeight)
  const width = Math.ceil(Math.max(irisWidth, eyelidWidth))
  const height = Math.ceil(Math.max(irisHeight, eyelidHeight))
  const irisBaseLeft = (width - irisWidth) / 2
  const irisBaseTop = (height - irisHeight) / 2
  const eyelidLeft = (width - eyelidWidth) / 2
  const eyelidTop = (height - eyelidHeight) / 2
  const irisMask = new Gray16Mask(width, height)
  const eyelidMask = new Gray16Mask(eyelidWidth, height)
  const initialIrisRect: Rect = {
    x: irisBaseLeft,
    y: irisBaseTop,
    width: irisWidth,
    height: irisHeight,
  }
  fillIrisMask(irisMask, shape, initialIrisRect, irisRadius)

  const irisPort = new Gray16MaskPort(null, {
    left: 0,
    top: 0,
    width,
    height,
    Behavior: class extends Behavior {
      #currentRect: Rect = { ...initialIrisRect }
      #nextRect: Rect = { ...initialIrisRect }
      #palette: FaceSkinPalette | null = null
      #primary = DEFAULT_FACE_PRIMARY_COLOR
      revision = 0

      onFaceSkin(port: PiuPort, palette: FaceSkinPalette) {
        this.#palette = palette
        if (this.#primary === palette.primaryColor) return
        this.#primary = palette.primaryColor
        port.invalidate()
      }

      onFaceState(port: PiuPort, face: FaceState) {
        if (!this.#palette) {
          const primary = toPiuColorNumber(face.theme.primary)
          if (primary !== this.#primary) {
            this.#primary = primary
            port.invalidate()
          }
        }
        const eye = face.eyes[opts.side]
        const gazeX = quantizeEdge(clamp(eye.gazeX ?? 0, -1, 1) * 2)
        const gazeY = quantizeEdge(clamp(eye.gazeY ?? 0, -1, 1) * 2)
        writeIrisRect(this.#nextRect, irisBaseLeft, irisBaseTop, irisWidth, irisHeight, gazeX, gazeY)
        if (this.#nextRect.x === this.#currentRect.x && this.#nextRect.y === this.#currentRect.y) return

        invalidateRect(port, this.#currentRect, width, height)
        invalidateRect(port, this.#nextRect, width, height)
        fillIrisMask(irisMask, shape, this.#nextRect, irisRadius)
        const swap = this.#currentRect
        this.#currentRect = this.#nextRect
        this.#nextRect = swap
        this.revision++
      }

      onDraw(port: MaskPort) {
        port.drawGray(irisMask, this.#primary)
      }
    },
  })

  const initialFace: FaceState = {
    mouth: { open: 0 },
    eyes: {
      left: { open: 1, gazeX: 0, gazeY: 0 },
      right: { open: 1, gazeX: 0, gazeY: 0 },
    },
    breath: 1,
    emotion: 0,
    theme: {
      primary: { r: 255, g: 255, b: 255 },
      secondary: { r: 0, g: 0, b: 0 },
    },
  }
  const initialAperture = createEyelidAperture()
  writeEyelidAperture(initialAperture, initialFace, opts.side, 1, eyelidHeight)
  initialAperture.topLeft += eyelidTop
  initialAperture.topRight += eyelidTop
  initialAperture.bottomLeft += eyelidTop
  initialAperture.bottomRight += eyelidTop
  eyelidMask.fillOutsideAperture(initialAperture)

  const eyelidPort = new Gray16MaskPort(null, {
    left: eyelidLeft,
    top: 0,
    width: eyelidWidth,
    height,
    Behavior: class extends Behavior {
      #current = { ...initialAperture }
      #next = createEyelidAperture()
      #palette: FaceSkinPalette | null = null
      #secondary = DEFAULT_FACE_SECONDARY_COLOR
      revision = 0

      onFaceSkin(port: PiuPort, palette: FaceSkinPalette) {
        this.#palette = palette
        if (this.#secondary === palette.secondaryColor) return
        this.#secondary = palette.secondaryColor
        port.invalidate()
      }

      onFaceState(port: PiuPort, face: FaceState) {
        if (!this.#palette) {
          const secondary = toPiuColorNumber(face.theme.secondary)
          if (secondary !== this.#secondary) {
            this.#secondary = secondary
            port.invalidate()
          }
        }
        writeEyelidAperture(this.#next, face, opts.side, face.eyes[opts.side].open, eyelidHeight)
        this.#next.topLeft += eyelidTop
        this.#next.topRight += eyelidTop
        this.#next.bottomLeft += eyelidTop
        this.#next.bottomRight += eyelidTop
        quantizeAperture(this.#next)
        if (!apertureChanged(this.#current, this.#next)) return

        invalidateApertureChange(port, this.#current, this.#next, eyelidWidth, height)
        eyelidMask.fillOutsideAperture(this.#next)
        copyAperture(this.#next, this.#current)
        this.revision++
      }

      onDraw(port: MaskPort) {
        port.drawGray(eyelidMask, this.#secondary)
      }
    },
  })

  return {
    clip: true,
    left: opts.cx - width / 2,
    top: opts.cy - height / 2,
    width,
    height,
    contents: [irisPort, eyelidPort],
  }
})
