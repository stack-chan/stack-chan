import type { CameraCaptureOptions, CameraFrame, CameraImageType, RobotCamera } from '../camera.js'
export type { CameraCaptureOptions, CameraFrame, CameraImageType, RobotCamera } from '../camera.js'

const DEFAULT_WIDTH = 96
const DEFAULT_HEIGHT = 96
const DEFAULT_IMAGE_TYPE: CameraImageType = 'rgb565le'

function normalizeDimension(value: number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback
  }
  const normalized = value | 0
  return normalized > 0 ? normalized : fallback
}

function writeRgb565Le(view: Uint8Array, width: number, height: number): void {
  let offset = 0
  const widthScale = Math.max(1, width - 1)
  const heightScale = Math.max(1, height - 1)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const red = (x * 31) / widthScale
      const green = ((x + y) * 63) / Math.max(1, width + height - 2)
      const blue = (y * 31) / heightScale
      const pixel = ((red & 0x1f) << 11) | ((green & 0x3f) << 5) | (blue & 0x1f)

      view[offset] = pixel & 0xff
      view[offset + 1] = (pixel >> 8) & 0xff
      offset += 2
    }
  }
}

export default class Camera implements RobotCamera {
  #started = false

  constructor(_options?: unknown) {
    void _options
  }

  start(_options?: CameraCaptureOptions): void {
    void _options
    this.#started = true
  }

  stop(): void {
    this.#started = false
  }

  async capture(options: CameraCaptureOptions = {}): Promise<CameraFrame | undefined> {
    const imageType = options.imageType ?? DEFAULT_IMAGE_TYPE
    if (imageType !== 'rgb565le') {
      return undefined
    }

    const width = normalizeDimension(options.width, DEFAULT_WIDTH)
    const height = normalizeDimension(options.height, DEFAULT_HEIGHT)
    const buffer = new ArrayBuffer(width * height * 2)
    writeRgb565Le(new Uint8Array(buffer), width, height)

    return {
      width,
      height,
      imageType,
      buffer,
    }
  }
}
