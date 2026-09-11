import { finiteNumber, StackchanError } from 'stackchan/errors'

export type FaceCanvas = { left: number; top: number; width: number; height: number }
export type FaceEye = {
  x: number
  y: number
  shape: 'circle' | 'roundRect'
  radius?: number
  width?: number
  height?: number
  r?: number
  eyelidWidth: number
  eyelidHeight: number
}
export type FaceMouth = {
  visible: boolean
  x: number
  y: number
  minWidth: number
  maxWidth: number
  minHeight: number
  maxHeight: number
}
export type ShapeFace = {
  canvas: FaceCanvas
  shape: { eyes: { left: FaceEye; right: FaceEye }; mouth: FaceMouth }
}

/** Shared geometry contract for the SDK host and the face editor. */
export function validateShapeFace(value: ShapeFace): void {
  const canvas = value?.canvas
  finiteNumber(canvas?.width, 'face width', 40, 320)
  finiteNumber(canvas?.height, 'face height', 40, 240)
  finiteNumber(canvas?.left, 'face left', 0, 320 - canvas.width)
  finiteNumber(canvas?.top, 'face top', 0, 240 - canvas.height)
  for (const side of ['left', 'right'] as const) {
    const eye = value.shape?.eyes?.[side]
    let width: number, height: number
    if (eye?.shape === 'circle') {
      finiteNumber(eye.radius ?? NaN, 'eye radius', 2, Math.min(40, canvas.width / 2, canvas.height / 2))
      width = height = (eye.radius ?? NaN) * 2
    } else if (eye?.shape === 'roundRect') {
      finiteNumber(eye.width ?? NaN, 'eye width', 4, Math.min(120, canvas.width))
      finiteNumber(eye.height ?? NaN, 'eye height', 4, Math.min(120, canvas.height))
      width = eye.width ?? NaN
      height = eye.height ?? NaN
      finiteNumber(eye.r ?? NaN, 'eye corner radius', 0, Math.min(width, height) / 2)
    } else throw new StackchanError('INVALID_ARGUMENT', 'Unknown eye shape')
    finiteNumber(eye.eyelidWidth, 'eyelid width', width, Math.min(120, canvas.width))
    finiteNumber(eye.eyelidHeight, 'eyelid height', height, Math.min(120, canvas.height))
    finiteNumber(eye.x, 'eye x', eye.eyelidWidth / 2, canvas.width - eye.eyelidWidth / 2)
    finiteNumber(eye.y, 'eye y', eye.eyelidHeight / 2, canvas.height - eye.eyelidHeight / 2)
  }
  const mouth = value.shape?.mouth
  if (typeof mouth?.visible !== 'boolean') throw new StackchanError('INVALID_ARGUMENT', 'Invalid mouth visibility')
  finiteNumber(mouth.x, 'mouth x', 0, canvas.width)
  finiteNumber(mouth.y, 'mouth y', 0, canvas.height)
  finiteNumber(mouth.minWidth, 'mouth minimum width', 1, canvas.width)
  finiteNumber(mouth.maxWidth, 'mouth maximum width', mouth.minWidth, canvas.width)
  finiteNumber(mouth.minHeight, 'mouth minimum height', 1, canvas.height)
  finiteNumber(mouth.maxHeight, 'mouth maximum height', mouth.minHeight, canvas.height)
}
