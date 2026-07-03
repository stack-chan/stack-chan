import type { RobotCamera } from 'camera'

const NULL_CAMERA: RobotCamera = {
  available: false,
  start() {},
  stop() {},
  async capture() {
    return undefined
  },
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

  async start(options?: Parameters<RobotCamera['start']>[0]): Promise<void> {
    const wasActive = this.#cameraActive
    if (!wasActive) this.#pauseTouchPanel()
    try {
      await this.#camera.start(options)
      this.#cameraActive = true
    } catch (error) {
      if (!wasActive) this.#resumeTouchPanel()
      throw error
    }
  }

  async stop(): Promise<void> {
    const wasActive = this.#cameraActive
    try {
      await this.#camera.stop()
    } finally {
      this.#cameraActive = false
      if (wasActive) this.#resumeTouchPanel()
    }
  }

  async capture(options?: Parameters<RobotCamera['capture']>[0]) {
    const wasActive = this.#cameraActive
    if (!wasActive) this.#pauseTouchPanel()
    try {
      return await this.#camera.capture(options)
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
      ;(globalThis as typeof globalThis & { trace?: (message: string) => void }).trace?.(
        `[runtime-camera] touch panel restart error ${errorMessage(error)}\n`,
      )
    }
  }
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}
