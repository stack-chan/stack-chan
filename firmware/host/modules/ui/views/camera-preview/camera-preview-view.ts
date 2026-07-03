import { FaceBase } from 'behaviors/face'
import {
  type CameraFrame,
  type CameraImageType,
  copyRgb565Frame,
  type MosaicBlock,
  sampleRgb565Mosaic,
  toPiuColorString,
} from 'camera-preview-utils'
import Bitmap from 'commodetto/Bitmap'
import config from 'mc/config'
import type { Container as PiuContainer, Port as PiuPort } from 'piu/MC'
import RuntimeBitmapPort from 'runtime-bitmap-port'

export const CAMERA_PREVIEW_WIDTH = 200
export const CAMERA_PREVIEW_HEIGHT = 120

export type CameraPreviewRenderMode = 'bitmap' | 'mosaic'
export type CameraPreviewOptions = {
  onRender?: (mode: CameraPreviewRenderMode) => void
  onDismiss?: () => void
}

export type CameraPreviewFrame = {
  width: number
  height: number
  imageType: CameraImageType
  buffer: ArrayBuffer
  blocks: MosaicBlock[]
}

const PREVIEW_LEFT = 60
const PREVIEW_TOP = 60
const PREVIEW_BLOCK_SIZE = 48
const PREVIEW_BACKGROUND = '#101010'
const PREVIEW_BITMAP_FORMAT =
  (Bitmap as unknown as Record<string, number>)[String((config as { format?: string }).format ?? '')] ?? Bitmap.RGB565LE
const PREVIEW_BITMAP_BYTE_ORDER = PREVIEW_BITMAP_FORMAT === Bitmap.RGB565BE ? 'be' : 'le'

type BitmapPort = PiuPort & {
  drawBitmap?: (bitmap: Bitmap, x: number, y: number, sx?: number, sy?: number, sw?: number, sh?: number) => void
  clearBitmap?: () => void
}

export function prepareCameraPreviewFrame(frame: CameraFrame): CameraPreviewFrame {
  const previewFrame = {
    width: CAMERA_PREVIEW_WIDTH,
    height: CAMERA_PREVIEW_HEIGHT,
    imageType: frame.imageType,
    buffer: copyRgb565Frame(frame, {
      width: CAMERA_PREVIEW_WIDTH,
      height: CAMERA_PREVIEW_HEIGHT,
      byteOrder: PREVIEW_BITMAP_BYTE_ORDER,
    }),
  }

  return {
    ...previewFrame,
    blocks: sampleRgb565Mosaic(frame, {
      width: CAMERA_PREVIEW_WIDTH,
      height: CAMERA_PREVIEW_HEIGHT,
      blockSize: PREVIEW_BLOCK_SIZE,
    }),
  }
}

function createPreviewBitmap(preview: CameraPreviewFrame): Bitmap | null {
  if (preview.imageType !== 'rgb565le' && preview.imageType !== 'rgb565be') return null
  if (preview.buffer.byteLength < preview.width * preview.height * 2) return null
  return new Bitmap(preview.width, preview.height, PREVIEW_BITMAP_FORMAT, preview.buffer, 0)
}

function drawPreviewBitmap(port: BitmapPort, preview: CameraPreviewFrame, bitmap: Bitmap | null): boolean {
  if (!port.drawBitmap || (preview.imageType !== 'rgb565le' && preview.imageType !== 'rgb565be')) return false
  if (preview.buffer.byteLength < preview.width * preview.height * 2) return false
  if (!bitmap) return false

  port.drawBitmap(bitmap, 0, 0, 0, 0, preview.width, preview.height)
  return true
}

export function createCameraPreviewFace(preview: CameraPreviewFrame, options: CameraPreviewOptions = {}): PiuContainer {
  const previewPort = new RuntimeBitmapPort(
    { preview, options },
    {
      left: 0,
      top: 0,
      width: CAMERA_PREVIEW_WIDTH,
      height: CAMERA_PREVIEW_HEIGHT,
      active: true,
      Behavior: class extends Behavior {
        preview: CameraPreviewFrame | null = null
        bitmap: Bitmap | null = null
        options: CameraPreviewOptions | null = null
        didReportRenderMode = false

        onCreate(_port: PiuPort, data: { preview: CameraPreviewFrame; options: CameraPreviewOptions }) {
          this.preview = data.preview
          this.bitmap = createPreviewBitmap(data.preview)
          this.options = data.options
        }

        onDisplaying(port: PiuPort) {
          port.invalidate()
        }

        onTouchEnded(_port: PiuPort) {
          this.options?.onDismiss?.()
        }

        onUndisplaying(port: PiuPort) {
          ;(port as BitmapPort).clearBitmap?.()
          this.preview = null
          this.bitmap = null
          this.options = null
        }

        onDraw(port: PiuPort) {
          port.fillColor(PREVIEW_BACKGROUND, 0, 0, CAMERA_PREVIEW_WIDTH, CAMERA_PREVIEW_HEIGHT)
          const preview = this.preview
          if (!preview) return

          if (drawPreviewBitmap(port as BitmapPort, preview, this.bitmap)) {
            this.reportRenderMode('bitmap')
            return
          }

          for (const block of preview.blocks) {
            port.fillColor(toPiuColorString(block.color), block.x, block.y, block.width, block.height)
          }
          this.reportRenderMode('mosaic')
        }

        reportRenderMode(mode: CameraPreviewRenderMode) {
          if (this.didReportRenderMode) return
          this.didReportRenderMode = true
          this.options?.onRender?.(mode)
        }
      },
    },
  )

  return new FaceBase({
    left: PREVIEW_LEFT,
    top: PREVIEW_TOP,
    width: CAMERA_PREVIEW_WIDTH,
    height: CAMERA_PREVIEW_HEIGHT,
    motions: [],
    contents: [previewPort],
  })
}
