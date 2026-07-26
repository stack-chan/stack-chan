const fillCircleNative = native('xs_stackchan_gray16_mask_fill_circle')
const fillOutsideApertureNative = native('xs_stackchan_gray16_mask_fill_outside_aperture')
const fillRotatedEllipseNative = native('xs_stackchan_gray16_mask_fill_rotated_ellipse')
const fillRoundRectNative = native('xs_stackchan_gray16_mask_fill_round_rect')
const fillTriangleNative = native('xs_stackchan_gray16_mask_fill_triangle')
const strokeSegmentNative = native('xs_stackchan_gray16_mask_stroke_segment')

export function fillCircle(bytes, width, height, strideWidth, cx, cy, radius) {
  fillCircleNative(bytes, width, height, strideWidth, cx, cy, radius)
}

export function fillOutsideAperture(bytes, width, height, strideWidth, topLeft, topRight, bottomLeft, bottomRight) {
  fillOutsideApertureNative(bytes, width, height, strideWidth, topLeft, topRight, bottomLeft, bottomRight)
}

export function fillRotatedEllipse(bytes, width, height, strideWidth, cx, cy, radiusX, radiusY, rotation) {
  fillRotatedEllipseNative(bytes, width, height, strideWidth, cx, cy, radiusX, radiusY, rotation)
}

export function fillRoundRect(bytes, maskWidth, maskHeight, strideWidth, left, top, width, height, radius) {
  fillRoundRectNative(bytes, maskWidth, maskHeight, strideWidth, left, top, width, height, radius)
}

export function fillTriangle(bytes, width, height, strideWidth, x0, y0, x1, y1, x2, y2) {
  fillTriangleNative(bytes, width, height, strideWidth, x0, y0, x1, y1, x2, y2)
}

export function strokeSegment(bytes, maskWidth, maskHeight, strideWidth, x0, y0, x1, y1, width) {
  strokeSegmentNative(bytes, maskWidth, maskHeight, strideWidth, x0, y0, x1, y1, width)
}
