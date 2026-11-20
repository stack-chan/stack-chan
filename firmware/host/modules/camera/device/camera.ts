import NativeCamera from 'embedded:io/image/in/camera'
import {
  type CameraCaptureRequest,
  cameraCaptureRequestMatches,
  normalizeCameraCaptureRequest,
} from 'camera-capture-options'
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
const DEFAULT_CAPTURE_REQUEST: CameraCaptureRequest = {
  width: DEFAULT_WIDTH,
  height: DEFAULT_HEIGHT,
  imageType: DEFAULT_IMAGE_TYPE,
}

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

function toNativeImageType(imageType: CameraImageType): number | undefined {
  if (imageType === 'rgb565le') return Bitmap.RGB565LE
  if (imageType === 'rgb565be') return Bitmap.RGB565BE
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
  #request: CameraCaptureRequest = DEFAULT_CAPTURE_REQUEST
  #running = false

  constructor(_options?: DeviceCameraConstructorOptions) {
    void _options
  }

  start(options: CameraCaptureOptions = {}): void {
    const request = normalizeCameraCaptureRequest(options, DEFAULT_CAPTURE_REQUEST)
    trace(`[camera] start request width=${request.width} height=${request.height} imageType=${request.imageType}\n`)
    const nativeImageType = toNativeImageType(request.imageType)
    if (nativeImageType === undefined) {
      this.#closeCamera()
      return
    }

    if (this.#camera && cameraCaptureRequestMatches(options, this.#request, DEFAULT_CAPTURE_REQUEST)) {
      this.#startCamera()
      return
    }

    this.#closeCamera()

    trace('[camera] native constructor begin\n')
    const camera = new ImageInCamera({
      width: request.width,
      height: request.height,
      imageType: nativeImageType,
      format: FORMAT_DISPOSABLE_BUFFER,
      onReadable: () => this.#readLatestFrame(),
    })
    trace(`[camera] native constructor ready width=${camera.width} height=${camera.height}\n`)

    this.#camera = camera
    this.#width = camera.width
    this.#height = camera.height
    this.#imageType = request.imageType
    this.#request = request
    this.#startCamera()
  }

  stop(): void {
    this.#stopCamera()
  }

  close(): void {
    this.#closeCamera()
  }

  async capture(options: CameraCaptureOptions = {}): Promise<CameraFrame | undefined> {
    const shouldRestart = this.#shouldRestart(options) || !this.#running
    trace(`[camera] capture begin restart=${shouldRestart}\n`)
    if (shouldRestart) {
      this.start(options)
    }

    const camera = this.#camera
    if (!camera) return undefined

    let frame = this.#takeFrame(camera)
    if (!frame) {
      trace('[camera] capture waiting for frame\n')
      frame = await this.#waitForFrame(camera)
    }
    if (!frame) {
      trace('[camera] capture no frame\n')
      return undefined
    }
    trace(`[camera] capture frame bytes=${frame.byteLength}\n`)

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
    if (this.#camera) trace('[camera] close\n')
    this.#stopCamera()
    if (this.#camera) trace('[camera] native close begin\n')
    this.#camera?.close()
    if (this.#camera) trace('[camera] native close done\n')
    this.#camera = undefined
    this.#running = false
  }

  #startCamera(): void {
    if (!this.#camera || this.#running) return
    closeFrame(this.#frame)
    this.#frame = undefined
    trace('[camera] native start begin\n')
    this.#camera.start()
    this.#running = true
    trace('[camera] native start done\n')
  }

  #stopCamera(): void {
    if (this.#camera && this.#running) {
      trace('[camera] native stop begin\n')
      this.#camera.stop()
      trace('[camera] native stop done\n')
    }
    closeFrame(this.#frame)
    this.#frame = undefined
    this.#running = false
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
    return !cameraCaptureRequestMatches(options, this.#request, DEFAULT_CAPTURE_REQUEST)
  }
}
