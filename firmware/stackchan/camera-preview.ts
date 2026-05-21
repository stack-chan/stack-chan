import { Container, type Container as PiuContainer, type Port as PiuPort, Port } from 'piu/MC'
import type { CameraFrame } from './camera.js'
import { sampleRgb565LeMosaic } from './camera-preview-utils.js'

export const CAMERA_PREVIEW_WIDTH = 200
export const CAMERA_PREVIEW_HEIGHT = 120

export type CameraPreviewRenderMode = 'mosaic'
export type CameraPreviewOptions = {
  onRender?: (mode: CameraPreviewRenderMode) => void
  onDismiss?: () => void
}

const PREVIEW_LEFT = 60
const PREVIEW_TOP = 60
const PREVIEW_BLOCK_SIZE = 48
const PREVIEW_BACKGROUND = '#101010'

function piuColor(color: number): string {
  const hex = color.toString(16).padStart(6, '0')
  return `#${hex}`
}

export function createCameraPreviewFace(frame: CameraFrame, options: CameraPreviewOptions = {}): PiuContainer {
  const previewPort = new Port(
    { frame, options },
    {
      left: 0,
      top: 0,
      width: CAMERA_PREVIEW_WIDTH,
      height: CAMERA_PREVIEW_HEIGHT,
      active: true,
      Behavior: class extends Behavior {
        frame: CameraFrame | null = null
        options: CameraPreviewOptions | null = null
        didReportRenderMode = false

        onCreate(_port: PiuPort, data: { frame: CameraFrame; options: CameraPreviewOptions }) {
          this.frame = data.frame
          this.options = data.options
        }

        onDisplaying(port: PiuPort) {
          port.invalidate()
        }

        onTouchEnded(_port: PiuPort) {
          this.options?.onDismiss?.()
        }

        onDraw(port: PiuPort) {
          port.fillColor(PREVIEW_BACKGROUND, 0, 0, CAMERA_PREVIEW_WIDTH, CAMERA_PREVIEW_HEIGHT)
          const frame = this.frame
          if (!frame) return

          for (const block of sampleRgb565LeMosaic(frame, {
            width: CAMERA_PREVIEW_WIDTH,
            height: CAMERA_PREVIEW_HEIGHT,
            blockSize: PREVIEW_BLOCK_SIZE,
          })) {
            port.fillColor(piuColor(block.color), block.x, block.y, block.width, block.height)
          }
          this.reportRenderMode()
        }

        reportRenderMode() {
          if (this.didReportRenderMode) return
          this.didReportRenderMode = true
          this.options?.onRender?.('mosaic')
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
