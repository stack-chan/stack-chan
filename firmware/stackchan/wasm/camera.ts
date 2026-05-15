import type { CameraCaptureOptions, CameraFrame, CameraImageType, RobotCamera } from '../camera.js'
export type { CameraCaptureOptions, CameraFrame, CameraImageType, RobotCamera } from '../camera.js'

const DEFAULT_WIDTH = 96
const DEFAULT_HEIGHT = 96
const DEFAULT_IMAGE_TYPE: CameraImageType = 'rgb565le'

type HostCameraBridge = {
  start?: (options?: CameraCaptureOptions) => Promise<void> | void
  stop?: () => Promise<void> | void
  capture?: (options?: CameraCaptureOptions) => Promise<CameraFrame | undefined> | CameraFrame | undefined
}

type WasmCameraBridge = {
  start: (width: number, height: number, useBrowserCamera: boolean) => Promise<void> | void
  stop: () => void
  capture: (width: number, height: number) => CameraFrame | undefined
}

const hostCamera = (): HostCameraBridge | undefined =>
  (globalThis as typeof globalThis & { Host?: { Camera?: HostCameraBridge } }).Host?.Camera

const wasmCameraBridge = (): WasmCameraBridge | undefined =>
  (globalThis as typeof globalThis & { __stackchanWasmCameraBridge?: WasmCameraBridge }).__stackchanWasmCameraBridge

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

function copyFrameToWasmHeap(frame: CameraFrame): CameraFrame {
  return {
    ...frame,
    buffer: frame.buffer.slice(0),
  }
}

export default class Camera implements RobotCamera {
  #started = false

  constructor(_options?: unknown) {
    void _options
  }

  async start(options?: CameraCaptureOptions): Promise<void> {
    const wasmBridge = wasmCameraBridge()
    if (wasmBridge) {
      await wasmBridge.start(
        normalizeDimension(options?.width, DEFAULT_WIDTH),
        normalizeDimension(options?.height, DEFAULT_HEIGHT),
        Boolean(options?.useBrowserCamera),
      )
      this.#started = true
      return
    }
    await hostCamera()?.start?.(options)
    this.#started = true
  }

  async stop(): Promise<void> {
    const wasmBridge = wasmCameraBridge()
    if (wasmBridge) {
      wasmBridge.stop()
      this.#started = false
      return
    }
    await hostCamera()?.stop?.()
    this.#started = false
  }

  async capture(options: CameraCaptureOptions = {}): Promise<CameraFrame | undefined> {
    const wasmBridge = wasmCameraBridge()
    if (wasmBridge) {
      const hostFrame = wasmBridge.capture(
        normalizeDimension(options.width, DEFAULT_WIDTH),
        normalizeDimension(options.height, DEFAULT_HEIGHT),
      )
      if (hostFrame !== undefined) {
        return copyFrameToWasmHeap(hostFrame)
      }
    }

    const hostFrame = await hostCamera()?.capture?.(options)
    if (hostFrame !== undefined) {
      return copyFrameToWasmHeap(hostFrame)
    }

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
