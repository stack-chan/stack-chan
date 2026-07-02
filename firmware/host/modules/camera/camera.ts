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
  readonly available?: boolean
  start(options?: CameraCaptureOptions): Promise<void> | void
  stop(): Promise<void> | void
  capture(options?: CameraCaptureOptions): Promise<CameraFrame | undefined>
}
