import type { CapabilityStatus } from 'stackchan/app'
import type { CameraImage, ImageFormat } from 'stackchan/image'
import type { OperationOptions } from 'stackchan/task'

export type { CameraImage, ImageFormat } from 'stackchan/image'
export type CameraInfo = CapabilityStatus & { readonly formats: readonly ImageFormat[] }
export type CaptureOptions = OperationOptions & { width?: number; height?: number; format?: ImageFormat }
export interface AppCamera {
  readonly info: CameraInfo
  /** Capture one image and stop the camera before completing. Dimensions may be rounded by hardware. */
  capture(options?: CaptureOptions): Promise<CameraImage>
}
