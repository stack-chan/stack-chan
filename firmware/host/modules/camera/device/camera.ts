import NativeCamera from 'embedded:io/image/in/camera'
import { waitForInitialCameraFrame } from 'camera-initial-frame'
import Bitmap from 'commodetto/Bitmap'
import type { CameraCaptureOptions, CameraFrame, CameraImageType, RobotCamera } from '../camera.js'

export type { CameraCaptureOptions, CameraFrame, CameraImageType, RobotCamera } from '../camera.js'

const DEFAULT_WIDTH = 176
const DEFAULT_HEIGHT = 144
const DEFAULT_IMAGE_TYPE: CameraImageType = 'rgb565le'
const FORMAT_DISPOSABLE_BUFFER = 'buffer/disposable'
const INITIAL_FRAME_TIMEOUT_MS = 500
const INITIAL_FRAME_POLL_MS = 30

export type DeviceCameraConstructorOptions = Record<string, never>

type DisposableCameraBuffer = ArrayBuffer & {
  close?: () => void
}

type NativeImageInCamera = {
  width: number
  height: number
  imageType: number
  start: () => void
  stop: () => void
  close: () => void
  read: () => DisposableCameraBuffer | undefined
}

type NativeImageInCameraConstructor = new (options: {
  width: number
  height: number
  imageType: number
  format: typeof FORMAT_DISPOSABLE_BUFFER
  onReadable: () => void
}) => NativeImageInCamera

const ImageInCamera = NativeCamera as NativeImageInCameraConstructor

function normalizeDimension(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback
  const normalized = value | 0
  return normalized > 0 ? normalized : fallback
}

function toNativeImageType(imageType: CameraImageType): number | undefined {
  if (imageType === 'rgb565le') return Bitmap.RGB565LE
  if (imageType === 'jpeg') return Bitmap.JPEG
  return undefined
}

function closeFrame(frame: DisposableCameraBuffer | undefined): void {
  frame?.close?.()
}

export default class Camera implements RobotCamera {
  readonly available = true

  #camera: NativeImageInCamera | undefined
  #frame: DisposableCameraBuffer | undefined
  #width = DEFAULT_WIDTH
  #height = DEFAULT_HEIGHT
  #imageType: CameraImageType = DEFAULT_IMAGE_TYPE

  constructor(_options?: DeviceCameraConstructorOptions) {
    void _options
  }

  start(options: CameraCaptureOptions = {}): void {
    this.#closeCamera()

    const imageType = options.imageType ?? DEFAULT_IMAGE_TYPE
    const nativeImageType = toNativeImageType(imageType)
    if (nativeImageType === undefined) return

    const camera = new ImageInCamera({
      width: normalizeDimension(options.width, DEFAULT_WIDTH),
      height: normalizeDimension(options.height, DEFAULT_HEIGHT),
      imageType: nativeImageType,
      format: FORMAT_DISPOSABLE_BUFFER,
      onReadable: () => this.#readLatestFrame(),
    })

    this.#camera = camera
    this.#width = camera.width
    this.#height = camera.height
    this.#imageType = imageType
    camera.start()
  }

  stop(): void {
    this.#closeCamera()
  }

  async capture(options: CameraCaptureOptions = {}): Promise<CameraFrame | undefined> {
    if (this.#shouldRestart(options)) {
      this.start(options)
    }

    const camera = this.#camera
    if (!camera) return undefined

    const frame = this.#takeFrame(camera) ?? (await this.#waitForFrame(camera))
    if (!frame) return undefined

    let isClosed = false
    return {
      width: this.#width,
      height: this.#height,
      imageType: this.#imageType,
      buffer: frame,
      close: () => {
        if (isClosed) return
        isClosed = true
        closeFrame(frame)
      },
    }
  }

  #closeCamera(): void {
    closeFrame(this.#frame)
    this.#frame = undefined
    this.#camera?.stop()
    this.#camera?.close()
    this.#camera = undefined
  }

  #readLatestFrame(): void {
    const frame = this.#camera?.read()
    if (!frame) return
    closeFrame(this.#frame)
    this.#frame = frame
  }

  #takeFrame(camera: NativeImageInCamera): DisposableCameraBuffer | undefined {
    const frame = this.#frame ?? camera.read()
    this.#frame = undefined
    return frame
  }

  #waitForFrame(camera: NativeImageInCamera): Promise<DisposableCameraBuffer | undefined> {
    return waitForInitialCameraFrame({
      isCurrent: () => camera === this.#camera,
      onTimeout: () => trace('[camera] capture timed out waiting for first frame\n'),
      pollMs: INITIAL_FRAME_POLL_MS,
      takeFrame: () => this.#takeFrame(camera),
      timeoutMs: INITIAL_FRAME_TIMEOUT_MS,
    })
  }

  #shouldRestart(options: CameraCaptureOptions): boolean {
    if (!this.#camera) return true
    const imageType = options.imageType ?? this.#imageType
    if (imageType !== this.#imageType) return true
    if (options.width !== undefined && normalizeDimension(options.width, DEFAULT_WIDTH) !== this.#width) return true
    if (options.height !== undefined && normalizeDimension(options.height, DEFAULT_HEIGHT) !== this.#height) return true
    return false
  }
}
