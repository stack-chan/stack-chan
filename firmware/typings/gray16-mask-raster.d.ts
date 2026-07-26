declare module 'parts/gray16-mask-raster' {
  export function fillCircle(
    bytes: Uint8Array,
    width: number,
    height: number,
    strideWidth: number,
    cx: number,
    cy: number,
    radius: number,
  ): void

  export function fillOutsideAperture(
    bytes: Uint8Array,
    width: number,
    height: number,
    strideWidth: number,
    topLeft: number,
    topRight: number,
    bottomLeft: number,
    bottomRight: number,
  ): void

  export function fillRotatedEllipse(
    bytes: Uint8Array,
    width: number,
    height: number,
    strideWidth: number,
    cx: number,
    cy: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
  ): void

  export function fillRoundRect(
    bytes: Uint8Array,
    maskWidth: number,
    maskHeight: number,
    strideWidth: number,
    left: number,
    top: number,
    width: number,
    height: number,
    radius: number,
  ): void

  export function fillTriangle(
    bytes: Uint8Array,
    width: number,
    height: number,
    strideWidth: number,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ): void

  export function strokeSegment(
    bytes: Uint8Array,
    maskWidth: number,
    maskHeight: number,
    strideWidth: number,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    width: number,
  ): void
}
