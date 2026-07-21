import type { CameraCaptureOptions, CameraFrame, CameraImageType, RobotCamera } from '../camera.js'

export type { CameraCaptureOptions, CameraFrame, CameraImageType, RobotCamera } from '../camera.js'

const DEFAULT_WIDTH = 96
const DEFAULT_HEIGHT = 96
const DEFAULT_IMAGE_TYPE: CameraImageType = 'rgb565le'
const DEFAULT_USE_BROWSER_CAMERA = true

export type WasmCameraConstructorOptions = {
  useBrowserCamera?: boolean
}

export type WasmCameraStartOptions = CameraCaptureOptions & {
  useBrowserCamera?: boolean
}

type HostCameraBridge = {
  start?: (options?: WasmCameraStartOptions) => Promise<void> | void
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

function resolveUseBrowserCamera(options: WasmCameraStartOptions | undefined, defaultValue: boolean): boolean {
  return options?.useBrowserCamera ?? defaultValue
}

function createHostCameraStartOptions(
  options: WasmCameraStartOptions | undefined,
  defaultUseBrowserCamera: boolean,
): WasmCameraStartOptions {
  const startOptions: WasmCameraStartOptions = {
    useBrowserCamera: resolveUseBrowserCamera(options, defaultUseBrowserCamera),
  }
  if (options?.width !== undefined) startOptions.width = options.width
  if (options?.height !== undefined) startOptions.height = options.height
  if (options?.imageType !== undefined) startOptions.imageType = options.imageType
  return startOptions
}

function writeRgb565(view: Uint8Array, width: number, height: number, imageType: CameraImageType): void {
  let offset = 0
  const widthScale = Math.max(1, width - 1)
  const heightScale = Math.max(1, height - 1)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const red = (x * 31) / widthScale
      const green = ((x + y) * 63) / Math.max(1, width + height - 2)
      const blue = (y * 31) / heightScale
      const pixel = ((red & 0x1f) << 11) | ((green & 0x3f) << 5) | (blue & 0x1f)

      if (imageType === 'rgb565be') {
        view[offset] = (pixel >> 8) & 0xff
        view[offset + 1] = pixel & 0xff
      } else {
        view[offset] = pixel & 0xff
        view[offset + 1] = (pixel >> 8) & 0xff
      }
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
  readonly available = true

  #started = false
  #useBrowserCamera: boolean

  constructor(options: WasmCameraConstructorOptions = {}) {
    this.#useBrowserCamera = options.useBrowserCamera ?? DEFAULT_USE_BROWSER_CAMERA
  }

  async start(options?: WasmCameraStartOptions): Promise<void> {
    const wasmBridge = wasmCameraBridge()
    if (wasmBridge) {
      await wasmBridge.start(
        normalizeDimension(options?.width, DEFAULT_WIDTH),
        normalizeDimension(options?.height, DEFAULT_HEIGHT),
        resolveUseBrowserCamera(options, this.#useBrowserCamera),
      )
      this.#started = true
      return
    }
    await hostCamera()?.start?.(createHostCameraStartOptions(options, this.#useBrowserCamera))
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
    if (imageType !== 'rgb565le' && imageType !== 'rgb565be') {
      return undefined
    }

    const width = normalizeDimension(options.width, DEFAULT_WIDTH)
    const height = normalizeDimension(options.height, DEFAULT_HEIGHT)
    const buffer = new ArrayBuffer(width * height * 2)
    writeRgb565(new Uint8Array(buffer), width, height, imageType)

    return {
      width,
      height,
      imageType,
      buffer,
    }
  }
}
