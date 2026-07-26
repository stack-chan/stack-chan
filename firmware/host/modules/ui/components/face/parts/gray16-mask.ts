import Bitmap from 'commodetto/Bitmap'
import type { EyelidAperture } from 'parts/eyelid-geometry'
import {
  fillCircle as rasterFillCircle,
  fillOutsideAperture as rasterFillOutsideAperture,
  fillRotatedEllipse as rasterFillRotatedEllipse,
  fillRoundRect as rasterFillRoundRect,
  fillTriangle as rasterFillTriangle,
  strokeSegment as rasterStrokeSegment,
} from 'parts/gray16-mask-raster'

/**
 * Mutable antialiased alpha mask for face parts. Allocate it with the part,
 * update its bytes only when geometry changes, and draw it through
 * Gray16MaskPort so each dirty region becomes one Poco command. Raster
 * primitives run in the shared native backend so animated parts do not spend
 * the JavaScript turn walking individual pixels.
 */
export class Gray16Mask {
  readonly bitmap: Bitmap
  readonly bytes: Uint8Array
  readonly height: number
  readonly strideWidth: number
  readonly width: number

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.ceil(width))
    this.height = Math.max(1, Math.ceil(height))
    this.strideWidth = (this.width + 1) & ~1
    this.bytes = new Uint8Array((this.strideWidth * this.height) >> 1)
    this.bytes.fill(0xff)
    this.bitmap = new Bitmap(
      this.strideWidth,
      this.height,
      Bitmap.Gray16,
      this.bytes.buffer as ArrayBuffer,
      this.bytes.byteOffset,
      this.bytes.byteLength,
    )
  }

  clear(): void {
    this.bytes.fill(0xff)
  }

  fillCircle(cx: number, cy: number, radius: number): void {
    rasterFillCircle(this.bytes, this.width, this.height, this.strideWidth, cx, cy, radius)
  }

  fillRoundRect(left: number, top: number, width: number, height: number, radius: number): void {
    rasterFillRoundRect(this.bytes, this.width, this.height, this.strideWidth, left, top, width, height, radius)
  }

  fillRotatedEllipse(cx: number, cy: number, radiusX: number, radiusY: number, rotation: number): void {
    rasterFillRotatedEllipse(this.bytes, this.width, this.height, this.strideWidth, cx, cy, radiusX, radiusY, rotation)
  }

  fillOutsideAperture(aperture: Readonly<EyelidAperture>): void {
    rasterFillOutsideAperture(
      this.bytes,
      this.width,
      this.height,
      this.strideWidth,
      aperture.topLeft,
      aperture.topRight,
      aperture.bottomLeft,
      aperture.bottomRight,
    )
  }

  strokeSegment(x0: number, y0: number, x1: number, y1: number, width: number): void {
    rasterStrokeSegment(this.bytes, this.width, this.height, this.strideWidth, x0, y0, x1, y1, width)
  }

  strokeQuadratic(
    x0: number,
    y0: number,
    controlX: number,
    controlY: number,
    x1: number,
    y1: number,
    width: number,
    steps = 16,
  ): void {
    let previousX = x0
    let previousY = y0
    for (let step = 1; step <= steps; step++) {
      const t = step / steps
      const inverse = 1 - t
      const x = inverse * inverse * x0 + 2 * inverse * t * controlX + t * t * x1
      const y = inverse * inverse * y0 + 2 * inverse * t * controlY + t * t * y1
      this.strokeSegment(previousX, previousY, x, y, width)
      previousX = x
      previousY = y
    }
  }

  strokeCubic(
    x0: number,
    y0: number,
    controlX0: number,
    controlY0: number,
    controlX1: number,
    controlY1: number,
    x1: number,
    y1: number,
    width: number,
    steps = 16,
  ): void {
    let previousX = x0
    let previousY = y0
    for (let step = 1; step <= steps; step++) {
      const t = step / steps
      const inverse = 1 - t
      const inverseSquared = inverse * inverse
      const tSquared = t * t
      const x =
        inverseSquared * inverse * x0 +
        3 * inverseSquared * t * controlX0 +
        3 * inverse * tSquared * controlX1 +
        tSquared * t * x1
      const y =
        inverseSquared * inverse * y0 +
        3 * inverseSquared * t * controlY0 +
        3 * inverse * tSquared * controlY1 +
        tSquared * t * y1
      this.strokeSegment(previousX, previousY, x, y, width)
      previousX = x
      previousY = y
    }
  }

  fillTriangle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): void {
    rasterFillTriangle(this.bytes, this.width, this.height, this.strideWidth, x0, y0, x1, y1, x2, y2)
  }
}
