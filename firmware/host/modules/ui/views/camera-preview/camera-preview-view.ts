import {
  type CameraFrame,
  type CameraImageType,
  type MosaicBlock,
  sampleRgb565LeMosaic,
  toPiuColorString,
} from 'camera-preview-utils'
import { Container, type Container as PiuContainer, type Port as PiuPort, Port } from 'piu/MC'

export const CAMERA_PREVIEW_WIDTH = 200
export const CAMERA_PREVIEW_HEIGHT = 120

export type CameraPreviewRenderMode = 'mosaic'
export type CameraPreviewOptions = {
  onRender?: (mode: CameraPreviewRenderMode) => void
  onDismiss?: () => void
}

export type CameraPreviewFrame = {
  width: number
  height: number
  imageType: CameraImageType
  blocks: MosaicBlock[]
}

const PREVIEW_LEFT = 60
const PREVIEW_TOP = 60
const PREVIEW_BLOCK_SIZE = 48
const PREVIEW_BACKGROUND = '#101010'

export function prepareCameraPreviewFrame(frame: CameraFrame): CameraPreviewFrame {
  return {
    width: CAMERA_PREVIEW_WIDTH,
    height: CAMERA_PREVIEW_HEIGHT,
    imageType: frame.imageType,
    blocks: sampleRgb565LeMosaic(frame, {
      width: CAMERA_PREVIEW_WIDTH,
      height: CAMERA_PREVIEW_HEIGHT,
      blockSize: PREVIEW_BLOCK_SIZE,
    }),
  }
}

export function createCameraPreviewFace(preview: CameraPreviewFrame, options: CameraPreviewOptions = {}): PiuContainer {
  const previewPort = new Port(
    { preview, options },
    {
      left: 0,
      top: 0,
      width: CAMERA_PREVIEW_WIDTH,
      height: CAMERA_PREVIEW_HEIGHT,
      active: true,
      Behavior: class extends Behavior {
        preview: CameraPreviewFrame | null = null
        options: CameraPreviewOptions | null = null
        didReportRenderMode = false

        onCreate(_port: PiuPort, data: { preview: CameraPreviewFrame; options: CameraPreviewOptions }) {
          this.preview = data.preview
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
          const preview = this.preview
          if (!preview) return

          for (const block of preview.blocks) {
            port.fillColor(toPiuColorString(block.color), block.x, block.y, block.width, block.height)
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
