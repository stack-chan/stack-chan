export type CameraImageType = 'rgb565le' | 'yuv422' | 'jpeg'

export type CameraFrame = {
  width: number
  height: number
  imageType: CameraImageType
  buffer: ArrayBuffer
  close?: () => void
}

export type CameraCaptureOptions = {
  width?: number
  height?: number
  imageType?: CameraImageType
  useBrowserCamera?: boolean
}

export interface RobotCamera {
  start(options?: CameraCaptureOptions): Promise<void> | void
  stop(): Promise<void> | void
  capture(options?: CameraCaptureOptions): Promise<CameraFrame | undefined>
}

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
