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

type DisposableCameraBuffer = (ArrayBuffer | HostBuffer) & {
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
  readonly availability = 'native' as const
  readonly formats = ['rgb565le', 'rgb565be', 'jpeg'] as const

  #camera: NativeImageInCamera | undefined
  #frame: DisposableCameraBuffer | undefined
  #width = DEFAULT_WIDTH
  #height = DEFAULT_HEIGHT
  #imageType: CameraImageType = DEFAULT_IMAGE_TYPE
  #request: CameraCaptureRequest = DEFAULT_CAPTURE_REQUEST
  #running = false
  #closed = false
  #epoch = 0
  #waits = new Set<() => void>()

  constructor(_options?: DeviceCameraConstructorOptions) {
    void _options
  }

  start(options: CameraCaptureOptions = {}): void {
    if (this.#closed) throw new Error('Camera is closed')
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
    let camera: NativeImageInCamera | undefined
    camera = new ImageInCamera({
      width: request.width,
      height: request.height,
      imageType: nativeImageType,
      format: FORMAT_DISPOSABLE_BUFFER,
      onReadable: () => {
        if (camera === this.#camera && this.#running) this.#readLatestFrame()
      },
    })
    trace(`[camera] native constructor ready width=${camera.width} height=${camera.height}\n`)

    this.#camera = camera
    try {
      this.#width = camera.width
      this.#height = camera.height
      this.#imageType = request.imageType
      this.#request = request
      this.#startCamera()
    } catch (error) {
      try {
        this.#closeCamera()
      } catch (cleanupError) {
        trace(`[camera] initialization cleanup failed: ${String(cleanupError)}\n`)
      }
      throw error
    }
  }

  stop(): void {
    this.#stopCamera()
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#closeCamera()
  }

  async capture(options: CameraCaptureOptions = {}): Promise<CameraFrame | undefined> {
    if (this.#closed) throw new Error('Camera is closed')
    const shouldRestart = this.#shouldRestart(options) || !this.#running
    trace(`[camera] capture begin restart=${shouldRestart}\n`)
    if (shouldRestart) {
      this.start(options)
    }

    const camera = this.#camera
    const epoch = this.#epoch
    if (!camera) return undefined

    let frame = this.#takeFrame(camera)
    if (!frame) {
      trace('[camera] capture waiting for frame\n')
      frame = await this.#waitForFrame(camera, epoch)
    }
    if (camera !== this.#camera || epoch !== this.#epoch || !this.#running) {
      closeFrame(frame)
      return undefined
    }
    if (!frame) {
      trace('[camera] capture no frame\n')
      return undefined
    }
    trace(`[camera] capture frame bytes=${frame.byteLength}\n`)

    // Native buffer/disposable frames are HostBuffers, not ArrayBuffers. Copy
    // while the camera still owns the storage, then release it on every path.
    let buffer: ArrayBuffer
    try {
      // XS accepts readable HostBuffers in TypedArray constructors.
      buffer = new Uint8Array(frame as ArrayBuffer).slice().buffer
    } finally {
      closeFrame(frame)
    }
    return {
      width: this.#width,
      height: this.#height,
      imageType: this.#imageType,
      buffer,
    }
  }

  #closeCamera(): void {
    this.#cancelWaits()
    const camera = this.#camera
    const frame = this.#frame
    const running = this.#running
    this.#camera = undefined
    this.#frame = undefined
    this.#running = false
    let failed = false
    let failure: unknown
    for (const cleanup of [
      () => {
        if (running) camera?.stop()
      },
      () => closeFrame(frame),
      () => camera?.close(),
    ]) {
      try {
        cleanup()
      } catch (error) {
        if (!failed) failure = error
        failed = true
      }
    }
    if (failed) throw failure
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
    this.#cancelWaits()
    const frame = this.#frame
    const running = this.#running
    this.#frame = undefined
    this.#running = false
    try {
      if (running) this.#camera?.stop()
    } finally {
      closeFrame(frame)
    }
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

  #cancelWaits(): void {
    this.#epoch++
    for (const cancel of this.#waits) cancel()
    this.#waits.clear()
  }

  #waitForFrame(camera: NativeImageInCamera, epoch: number): Promise<DisposableCameraBuffer | undefined> {
    return waitForInitialCameraFrame({
      isCurrent: () => camera === this.#camera && epoch === this.#epoch && this.#running,
      subscribeCancellation: (cancel) => {
        this.#waits.add(cancel)
        return () => {
          this.#waits.delete(cancel)
        }
      },
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
