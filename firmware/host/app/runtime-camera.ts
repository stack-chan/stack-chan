import type { RobotCamera } from 'camera'

const NULL_CAMERA: RobotCamera = {
  available: false,
  start() {},
  stop() {},
  close() {},
  async capture() {
    return undefined
  },
}

function traceMessage(message: string): void {
  ;(globalThis as typeof globalThis & { trace?: (message: string) => void }).trace?.(message)
}

function isThenable(value: unknown): value is Promise<void> {
  if (!value || typeof value !== 'object') return false
  return typeof (value as { then?: unknown }).then === 'function'
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

  constructor(params: RuntimeCameraConstructorParam) {
    this.#camera = params.camera ?? NULL_CAMERA
    this.#touchPanel = params.touchPanel
  }

  get available(): boolean | undefined {
    return this.#camera.available
  }

  get camera(): RobotCamera {
    return this
  }

  start(options?: Parameters<RobotCamera['start']>[0]): Promise<void> | void {
    const wasActive = this.#cameraActive
    if (!wasActive) this.#pauseTouchPanel()
    try {
      traceMessage('[runtime-camera] start begin\n')
      const result = this.#camera.start(options)
      if (isThenable(result)) {
        return result.then(
          () => {
            traceMessage('[runtime-camera] start done\n')
            this.#cameraActive = true
          },
          (error) => {
            if (!wasActive) this.#resumeTouchPanel()
            throw error
          },
        )
      }
      traceMessage('[runtime-camera] start done\n')
      this.#cameraActive = true
    } catch (error) {
      if (!wasActive) this.#resumeTouchPanel()
      throw error
    }
  }

  stop(): Promise<void> | void {
    const wasActive = this.#cameraActive
    const finish = () => {
      traceMessage('[runtime-camera] stop camera done\n')
      this.#cameraActive = false
      if (wasActive) {
        traceMessage('[runtime-camera] touch panel resume begin\n')
        this.#resumeTouchPanel()
        traceMessage('[runtime-camera] touch panel resume done\n')
      }
    }

    try {
      traceMessage('[runtime-camera] stop begin\n')
      const result = this.#camera.stop()
      if (isThenable(result)) {
        return result.then(
          () => finish(),
          (error) => {
            this.#cameraActive = false
            if (wasActive) this.#resumeTouchPanel()
            throw error
          },
        )
      }
      finish()
    } catch (error) {
      this.#cameraActive = false
      if (wasActive) this.#resumeTouchPanel()
      throw error
    }
  }

  close(): Promise<void> | void {
    const finish = () => {
      const result = this.#camera.close?.()
      const done = () => {
        traceMessage('[runtime-camera] close done\n')
      }
      if (isThenable(result)) return result.then(done)
      done()
    }

    try {
      traceMessage('[runtime-camera] close begin\n')
      const result = this.#camera.stop()
      this.#cameraActive = false
      this.#touchPanelPaused = false
      if (isThenable(result)) return result.then(() => finish())
      return finish()
    } catch (error) {
      this.#cameraActive = false
      this.#touchPanelPaused = false
      throw error
    }
  }

  async capture(options?: Parameters<RobotCamera['capture']>[0]) {
    const wasActive = this.#cameraActive
    if (!wasActive) this.#pauseTouchPanel()
    try {
      traceMessage('[runtime-camera] capture begin\n')
      const frame = await this.#camera.capture(options)
      traceMessage(`[runtime-camera] capture done frame=${frame ? 'yes' : 'no'}\n`)
      return frame
    } finally {
      if (!wasActive) this.#resumeTouchPanel()
    }
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
      traceMessage(`[runtime-camera] touch panel restart error ${errorMessage(error)}\n`)
    }
  }
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}
