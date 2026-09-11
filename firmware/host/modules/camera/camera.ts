import type { ImageFormat } from '../../../sdk/image.js'
export type CameraImageType = ImageFormat | 'yuv422'

export type CameraFrame = {
  source?: 'native' | 'simulated'
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
}

export interface RobotCamera {
  readonly formats?: readonly ImageFormat[]
  readonly availability?: 'native' | 'simulated' | 'unavailable'
  readonly available?: boolean
  start(options?: CameraCaptureOptions): Promise<void> | void
  stop(): Promise<void> | void
  close?(): Promise<void> | void
  capture(options?: CameraCaptureOptions): Promise<CameraFrame | undefined>
}
