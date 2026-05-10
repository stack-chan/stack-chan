export const IMAGE_FACE_TEXTURE_PATHS = Object.freeze({
  iris: 'eye.png',
  eyelid: 'eyelid.png',
  mouth: 'mouth.png',
})

export const IRIS_SPRITE = Object.freeze({
  width: 16,
  height: 16,
  baseLeft: 4,
  baseTop: 4,
  gazePixels: 8,
  // Keep iris fully inside 24x24 eye container.
  maxOffset: 4,
})

export const EYELID_SPRITE = Object.freeze({
  width: 24,
  height: 24,
  frameCount: 7,
})

export const MOUTH_SPRITE = Object.freeze({
  width: 80,
  height: 40,
  frameCount: 6,
})

function clamp01(v: number): number {
  if (v < 0) return 0
  if (v > 1) return 1
  return v
}

export function openToVariant(open: number, frameCount: number): number {
  if (frameCount <= 1) return 0
  return Math.round(clamp01(open) * (frameCount - 1))
}

// Generated eyelid sheet is arranged:
// 0=open, 1=closed, 2..6=opening.
// We map eye.open to 1..6 so open=0 => closed(1), open=1 => fully open(6).
export function eyeOpenToVariant(open: number): number {
  return 1 + openToVariant(open, 6)
}

export function gazeToOffset(gaze: number, pixels: number, maxOffset = pixels): number {
  const normalized = gaze < -1 ? -1 : gaze > 1 ? 1 : gaze
  const scaled = normalized * pixels
  if (scaled < -maxOffset) return -maxOffset
  if (scaled > maxOffset) return maxOffset
  return scaled
}
