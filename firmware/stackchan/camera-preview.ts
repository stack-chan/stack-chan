import type { CameraFrame } from './camera.js'
import { sampleRgb565LeMosaic } from './camera-preview-utils.js'

import Bitmap from 'commodetto/Bitmap'
import { Container, Port, type Container as PiuContainer, type Port as PiuPort } from 'piu/MC'

export const CAMERA_PREVIEW_WIDTH = 200
export const CAMERA_PREVIEW_HEIGHT = 120

export type CameraPreviewRenderMode = 'bitmap' | 'mosaic'
export type CameraPreviewOptions = {
  onRender?: (mode: CameraPreviewRenderMode) => void
}

const PREVIEW_LEFT = 60
const PREVIEW_TOP = 60
const PREVIEW_BLOCK_SIZE = 48
const PREVIEW_BACKGROUND = '#101010'

type BitmapPort = PiuPort & {
  drawBitmap?: (
    bitmap: Bitmap,
    x: number,
    y: number,
    sx?: number,
    sy?: number,
    sw?: number,
    sh?: number,
  ) => void
}

function piuColor(color: number): string {
  const hex = color.toString(16).padStart(6, '0')
  return `#${hex}`
}

function canDrawFrameAsBitmap(frame: CameraFrame): boolean {
  return frame.imageType === 'rgb565le' && frame.buffer.byteLength >= frame.width * frame.height * 2
}

function drawRgb565Bitmap(port: BitmapPort, frame: CameraFrame): boolean {
  if (!port.drawBitmap || !canDrawFrameAsBitmap(frame)) return false

  const bitmap = new Bitmap(frame.width, frame.height, Bitmap.RGB565LE, frame.buffer, 0)
  port.drawBitmap(
    bitmap,
    0,
    0,
    0,
    0,
    Math.min(frame.width, CAMERA_PREVIEW_WIDTH),
    Math.min(frame.height, CAMERA_PREVIEW_HEIGHT),
  )
  return true
}

export function createCameraPreviewFace(frame: CameraFrame, options: CameraPreviewOptions = {}): PiuContainer {
  const previewPort = new Port(
    { frame, options },
    {
      left: 0,
      top: 0,
      width: CAMERA_PREVIEW_WIDTH,
      height: CAMERA_PREVIEW_HEIGHT,
      Behavior: class extends Behavior {
        frame: CameraFrame | null = null
        options: CameraPreviewOptions | null = null
        lastRenderMode: CameraPreviewRenderMode | null = null

        onCreate(_port: PiuPort, data: { frame: CameraFrame; options: CameraPreviewOptions }) {
          this.frame = data.frame
          this.options = data.options
        }

        onDisplaying(port: PiuPort) {
          port.invalidate()
        }

        onDraw(port: PiuPort) {
          port.fillColor(PREVIEW_BACKGROUND, 0, 0, CAMERA_PREVIEW_WIDTH, CAMERA_PREVIEW_HEIGHT)
          const frame = this.frame
          if (!frame) return

          if (drawRgb565Bitmap(port as BitmapPort, frame)) {
            this.reportRenderMode('bitmap')
            return
          }

          for (const block of sampleRgb565LeMosaic(frame, {
            width: CAMERA_PREVIEW_WIDTH,
            height: CAMERA_PREVIEW_HEIGHT,
            blockSize: PREVIEW_BLOCK_SIZE,
          })) {
            port.fillColor(piuColor(block.color), block.x, block.y, block.width, block.height)
          }
          this.reportRenderMode('mosaic')
        }

        reportRenderMode(mode: CameraPreviewRenderMode) {
          if (this.lastRenderMode === mode) return
          this.lastRenderMode = mode
          this.options?.onRender?.(mode)
        }
      },
    },
  )

  return new Container(null, {
    left: PREVIEW_LEFT,
    top: PREVIEW_TOP,
    width: CAMERA_PREVIEW_WIDTH,
    height: CAMERA_PREVIEW_HEIGHT,
    contents: [previewPort],
  })
}
