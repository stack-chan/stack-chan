import type { CameraFrame, RobotCamera } from 'camera'
import { CameraCaptureSession } from 'camera-capture-session'
import type { OperationClock } from 'operation-queue'
import { OwnedResources, ResourceScope } from 'owned-resources'
import { ownCamera } from 'runtime-resources'
import type { CameraInfo } from 'stackchan/camera'
import { StackchanError } from 'stackchan/errors'
import Timer from 'timer'

const OPERATION_TIMEOUT_MS = 15_000
const STOP_TIMEOUT_MS = 2_000

const NULL_CAMERA: RobotCamera = {
  available: false,
  start() {},
  stop() {},
  close() {},
  async capture() {
    return undefined
  },
}

function isThenable(value: unknown): value is Promise<void> {
  return !!value && typeof (value as { then?: unknown }).then === 'function'
}

type ManagedTouchPanel = {
  start(): void
  stop(): void
}

export type RuntimeCameraConstructorParam = {
  camera?: RobotCamera
  touchPanel?: ManagedTouchPanel
}

export class StackchanRuntimeCamera implements RobotCamera {
  #camera: RobotCamera
  #cameraActive = false
  #touchPanel: ManagedTouchPanel | undefined
  #touchPanelPaused = false
  #busy = false
  #closed = false
  #devices: ResourceScope
  #shutdown: OwnedResources | undefined
  #pending = new Set<(error: unknown) => void>()

  constructor(params: RuntimeCameraConstructorParam, devices?: ResourceScope) {
    this.#camera = params.camera ?? NULL_CAMERA
    this.#touchPanel = params.touchPanel
    this.#devices = devices ?? new ResourceScope()
    if (!devices) ownCamera(this.#devices, this.#camera)
  }

  get available(): boolean | undefined {
    return this.#camera.available
  }

  get camera(): RobotCamera {
    return this
  }

  get info(): CameraInfo {
    const availability = this.#camera.availability ?? (this.#camera.available ? 'native' : 'unavailable')
    return availability === 'unavailable'
      ? { availability, formats: [], reason: 'Camera is unavailable on this target' }
      : { availability, formats: this.#camera.formats ?? ['rgb565le'] }
  }

  createCaptureSession(clock: OperationClock): CameraCaptureSession {
    const runtime = this
    let held = false
    return new CameraCaptureSession(
      {
        get info() {
          return runtime.info
        },
        async start(request) {
          if (runtime.#cameraActive) throw new StackchanError('BUSY', 'Camera is in use by a live preview')
          runtime.#begin()
          held = true
          runtime.#pauseTouchPanel()
          await runtime.#camera.start({ width: request.width, height: request.height, imageType: request.format })
        },
        async capture(request) {
          const frame = await runtime.#camera.capture({
            width: request.width,
            height: request.height,
            imageType: request.format,
          })
          return (
            frame && {
              width: frame.width,
              height: frame.height,
              format: frame.imageType,
              source: frame.source,
              data: frame.buffer,
              close: () => frame.close?.(),
            }
          )
        },
        async stop() {
          if (!held) return
          held = false
          try {
            await runtime.#camera.stop()
          } catch (error) {
            runtime.#stopFailed(error)
          } finally {
            runtime.#busy = false
            if (!runtime.#closed) runtime.#resumeTouchPanel()
          }
        },
      },
      clock,
    )
  }

  start(options?: Parameters<RobotCamera['start']>[0]): Promise<void> | void {
    this.#begin()
    const wasActive = this.#cameraActive
    const finish = (started: boolean) => {
      this.#busy = false
      if (this.#closed) return
      if (started) this.#cameraActive = true
      else if (!wasActive) this.#resumeTouchPanel()
    }
    try {
      if (!wasActive) this.#pauseTouchPanel()
      const result = this.#camera.start(options)
      if (isThenable(result)) {
        return this.#observe(result).then(
          () => finish(true),
          (error) => {
            finish(false)
            throw error
          },
        )
      }
      finish(true)
    } catch (error) {
      finish(false)
      throw error
    }
  }

  stop(): Promise<void> | void {
    this.#begin()
    const finish = () => {
      this.#busy = false
      this.#cameraActive = false
      if (!this.#closed) this.#resumeTouchPanel()
    }
    try {
      const result = this.#camera.stop()
      if (isThenable(result)) return this.#observe(result).then(finish, (error) => this.#stopFailed(error))
      finish()
    } catch (error) {
      this.#stopFailed(error)
    }
  }

  close(): Promise<void> {
    if (!this.#shutdown) {
      this.#closed = true
      this.#cameraActive = false
      this.#touchPanelPaused = false
      this.#shutdown = new OwnedResources([
        () => {
          const error = new StackchanError('CLOSED', 'Camera is closed')
          for (const cancel of [...this.#pending]) cancel(error)
        },
        () => {
          const result = this.#camera.stop()
          // A driver which never acknowledges stop must not hold the rest of
          // host teardown hostage. Device close is attempted after this timeout.
          if (isThenable(result)) return this.#observe(result, undefined, STOP_TIMEOUT_MS, false)
        },
        () => this.#devices.close(),
      ])
    }
    return this.#shutdown.close()
  }

  async capture(options?: Parameters<RobotCamera['capture']>[0]): Promise<CameraFrame | undefined> {
    this.#begin()
    const wasActive = this.#cameraActive
    let frame: CameraFrame | undefined
    try {
      if (!wasActive) this.#pauseTouchPanel()
      frame = await this.#observe(this.#camera.capture(options), (frame) => frame?.close?.())
      return frame
    } finally {
      await this.#finishCapture(wasActive, frame)
    }
  }

  async #finishCapture(wasActive: boolean, frame: CameraFrame | undefined): Promise<void> {
    try {
      if (!this.#closed && !wasActive) {
        const stopped = this.#camera.stop()
        if (isThenable(stopped)) await this.#observe(stopped, undefined, STOP_TIMEOUT_MS)
      }
    } catch (error) {
      try {
        frame?.close?.()
      } finally {
        this.#stopFailed(error)
      }
    } finally {
      this.#busy = false
      if (!this.#closed && !wasActive) this.#resumeTouchPanel()
    }
  }

  #begin(): void {
    if (this.#closed) throw new StackchanError('CLOSED', 'Camera is closed')
    if (this.#busy) throw new StackchanError('BUSY', 'Camera operation is already running')
    this.#busy = true
  }

  #stopFailed(error: unknown): never {
    this.#busy = false
    // Input must stay paused if the camera has not acknowledged stopping.
    void this.close().catch((cleanupError) => trace(`[camera] cleanup failed: ${String(cleanupError)}\n`))
    throw error
  }

  #observe<T>(
    result: Promise<T>,
    discard?: (value: T) => void,
    timeoutMs = OPERATION_TIMEOUT_MS,
    closeOnTimeout = true,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false
      let timer: ReturnType<typeof Timer.set> | undefined
      const settle = (error: unknown, value?: T, failed = true) => {
        if (settled) return
        settled = true
        if (timer !== undefined) Timer.clear(timer)
        this.#pending.delete(cancel)
        if (failed) reject(error)
        else resolve(value)
      }
      const cancel = (error: unknown) => settle(error)
      this.#pending.add(cancel)
      timer = Timer.set(() => {
        cancel(new StackchanError('TIMEOUT', 'Camera operation timed out'))
        if (closeOnTimeout) {
          void this.close().catch((error) => trace(`[camera] cleanup failed: ${String(error)}\n`))
        }
      }, timeoutMs)
      result.then((value) => {
        if (settled) {
          try {
            discard?.(value)
          } catch (error) {
            trace(`[camera] late frame cleanup failed: ${String(error)}\n`)
          }
          return
        }
        settle(undefined, value, false)
      }, cancel)
    })
  }

  #pauseTouchPanel(): void {
    if (!this.#touchPanel || this.#touchPanelPaused) return
    this.#touchPanel.stop()
    this.#touchPanelPaused = true
  }

  #resumeTouchPanel(): void {
    if (!this.#touchPanel || !this.#touchPanelPaused) return
    this.#touchPanelPaused = false
    try {
      this.#touchPanel.start()
    } catch (error) {
      trace(`[camera] touch panel restart failed: ${String(error)}\n`)
    }
  }
}
