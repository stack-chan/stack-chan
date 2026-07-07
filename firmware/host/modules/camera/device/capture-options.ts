export type CameraImageType = 'rgb565le' | 'rgb565be' | 'yuv422' | 'jpeg'

export type CameraCaptureOptions = {
  width?: number
  height?: number
  imageType?: CameraImageType
}

export type CameraCaptureRequest = {
  width: number
  height: number
  imageType: CameraImageType
}

export function normalizeDimension(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback
  const normalized = value | 0
  return normalized > 0 ? normalized : fallback
}

export function normalizeCameraCaptureRequest(
  options: CameraCaptureOptions | undefined,
  defaults: CameraCaptureRequest,
): CameraCaptureRequest {
  return {
    width: normalizeDimension(options?.width, defaults.width),
    height: normalizeDimension(options?.height, defaults.height),
    imageType: options?.imageType ?? defaults.imageType,
  }
}

export function cameraCaptureRequestMatches(
  options: CameraCaptureOptions | undefined,
  current: CameraCaptureRequest,
  defaults: CameraCaptureRequest,
): boolean {
  const requested = normalizeCameraCaptureRequest(options, defaults)
  return (
    requested.width === current.width &&
    requested.height === current.height &&
    requested.imageType === current.imageType
  )
}
