import { type OperationClock, OperationQueue } from 'operation-queue'
import type { AppCamera, CameraImage, CameraInfo, CaptureOptions, ImageFormat } from 'stackchan/camera'
import { asStackchanError, finiteNumber, StackchanError } from 'stackchan/errors'

export type CaptureRequest = { width: number; height: number; format: ImageFormat }
export type CaptureFrame = {
  width: number
  height: number
  format: string
  source?: 'native' | 'simulated'
  data: ArrayBuffer
  close?(): void
}
export type CameraPort = {
  readonly info: CameraInfo
  start(request: CaptureRequest): void | Promise<void>
  capture(request: CaptureRequest): Promise<CaptureFrame | undefined>
  stop(): void | Promise<void>
}
type CaptureOperation = { started: boolean; cancelled?: unknown; stop?: Promise<void> }

/** One app owns its requests; the host port owns the camera and any shared input pins. */
export class CameraCaptureSession implements AppCamera {
  readonly #port: CameraPort
  readonly #queue: OperationQueue
  #fault?: StackchanError
  #closePromise?: Promise<void>
  constructor(port: CameraPort, clock: OperationClock) {
    this.#port = port
    this.#queue = new OperationQueue({ clock, capacity: 2, operationTimeoutMs: 15_000, cancellationTimeoutMs: 2000 })
  }
  get info(): CameraInfo {
    return this.#port.info
  }
  async capture(options: CaptureOptions = {}): Promise<CameraImage> {
    if (this.#queue.closed) throw new StackchanError('CLOSED', 'Camera session is closed')
    if (this.#fault) throw this.#fault
    const request = {
      width: options.width ?? 176,
      height: options.height ?? 144,
      format: options.format ?? 'rgb565le',
    } satisfies CaptureRequest
    finiteNumber(request.width, 'width', 1, 320)
    finiteNumber(request.height, 'height', 1, 240)
    if (!Number.isInteger(request.width) || !Number.isInteger(request.height))
      throw new StackchanError('INVALID_ARGUMENT', 'Image dimensions must be integers')
    if (!['rgb565le', 'rgb565be', 'jpeg'].includes(request.format))
      throw new StackchanError('INVALID_ARGUMENT', 'Unknown image format')
    if (this.info.availability === 'unavailable' || !this.info.formats.includes(request.format))
      throw new StackchanError('UNSUPPORTED', 'Camera or requested image format is unavailable')
    const operation: CaptureOperation = { started: false }
    return this.#queue.run(
      async () => {
        if (this.#fault) throw this.#fault
        operation.started = true
        try {
          await this.#port.start(request)
          if (operation.cancelled) throw operation.cancelled
          const frame = await this.#port.capture(request)
          if (!frame) throw new StackchanError('IO', 'Camera returned no image')
          let image: CameraImage
          try {
            if (operation.cancelled) throw operation.cancelled
            this.#validateFrame(frame, request)
            image = Object.freeze({
              width: frame.width,
              height: frame.height,
              format: request.format,
              source: frame.source ?? (this.info.availability === 'simulated' ? 'simulated' : 'native'),
              data: frame.data.slice(0),
            })
          } finally {
            this.#releaseFrame(frame)
          }
          if (operation.cancelled) throw operation.cancelled
          return image
        } finally {
          await this.#stop(operation)
        }
      },
      (reason) => {
        operation.cancelled = reason
        return this.#stop(operation)
      },
      options.signal,
    )
  }
  close(): Promise<void> {
    this.#closePromise ??= this.#queue.close().then(() => {
      if (this.#fault) throw this.#fault
    })
    return this.#closePromise
  }
  #releaseFrame(frame: CaptureFrame): void {
    try {
      frame.close?.()
    } catch (error) {
      this.#fault = asStackchanError(error)
      throw this.#fault
    }
  }
  #stop(operation: CaptureOperation): Promise<void> {
    operation.stop ??= Promise.resolve()
      .then(() => (operation.started ? this.#port.stop() : undefined))
      .catch((error) => {
        this.#fault = asStackchanError(error)
        throw this.#fault
      })
    return operation.stop
  }
  #validateFrame(frame: CaptureFrame, request: CaptureRequest): void {
    const valid =
      Number.isInteger(frame.width) &&
      frame.width >= 1 &&
      frame.width <= 320 &&
      Number.isInteger(frame.height) &&
      frame.height >= 1 &&
      frame.height <= 240 &&
      frame.format === request.format &&
      frame.data instanceof ArrayBuffer &&
      frame.data.byteLength > 0 &&
      frame.data.byteLength <= 153_600
    if (!valid || (frame.format !== 'jpeg' && frame.data.byteLength !== frame.width * frame.height * 2))
      throw new StackchanError('IO', 'Camera returned an invalid image')
    if (frame.source !== undefined && frame.source !== 'native' && frame.source !== 'simulated')
      throw new StackchanError('IO', 'Camera returned an invalid source')
  }
}
