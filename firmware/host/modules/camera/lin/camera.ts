import type { CameraCaptureOptions, CameraFrame, RobotCamera } from '../camera.js'

export type { CameraCaptureOptions, CameraFrame, CameraImageType, RobotCamera } from '../camera.js'

export default class Camera implements RobotCamera {
  constructor(_options?: unknown) {
    void _options
  }

  start(_options?: CameraCaptureOptions): void {
    void _options
  }

  stop(): void {}

  async capture(_options?: CameraCaptureOptions): Promise<CameraFrame | undefined> {
    void _options
    return undefined
  }
}
