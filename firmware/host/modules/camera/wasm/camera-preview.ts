import { sampleRgb565LeMosaic, toPiuColorString } from 'camera-preview-utils'
import Bitmap from 'commodetto/Bitmap'
import type { MainContent } from 'common-view'
import { Container, Label, type Port as PiuPort, Skin } from 'piu/MC'
import RuntimeBitmapPort from 'runtime-bitmap-port'
import { ActionButton } from 'ui-controls'
import { uiStyles } from 'ui-theme'
import type { CameraFrame } from '../camera.js'

export const CAMERA_PREVIEW_WIDTH = 200
export const CAMERA_PREVIEW_HEIGHT = 120

export type CameraPreviewRenderMode = 'runtime-bitmap-port' | 'mosaic'
export type CameraPreviewOptions = {
  onRender?: (mode: CameraPreviewRenderMode) => void
  onDismiss?: () => void
  /** Caption drawn at the bottom of the full-area dialog. */
  caption?: string
}
export type CameraPreviewFrame = CameraFrame

const PREVIEW_LEFT = 60
const PREVIEW_TOP = 60
const PREVIEW_BLOCK_SIZE = 48
const PREVIEW_BACKGROUND = '#101010'
const DIALOG_BACKGROUND = '#000000'
const DEFAULT_CAPTION = 'カメラ'

type BitmapPort = PiuPort & {
  drawBitmap?: (bitmap: Bitmap, x: number, y: number, sx?: number, sy?: number, sw?: number, sh?: number) => void
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

export function prepareCameraPreviewFrame(frame: CameraFrame): CameraPreviewFrame {
  return frame
}

export function createCameraPreviewDialog(frame: CameraPreviewFrame, options: CameraPreviewOptions = {}): MainContent {
  const previewPort = new RuntimeBitmapPort(
    { frame, options },
    {
      left: PREVIEW_LEFT,
      top: PREVIEW_TOP,
      width: CAMERA_PREVIEW_WIDTH,
      height: CAMERA_PREVIEW_HEIGHT,
      active: true,
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

        onTouchEnded(_port: PiuPort) {
          this.options?.onDismiss?.()
        }

        onDraw(port: PiuPort) {
          port.fillColor(PREVIEW_BACKGROUND, 0, 0, CAMERA_PREVIEW_WIDTH, CAMERA_PREVIEW_HEIGHT)
          const frame = this.frame
          if (!frame) return

          if (drawRgb565Bitmap(port as BitmapPort, frame)) {
            this.reportRenderMode('runtime-bitmap-port')
            return
          }

          for (const block of sampleRgb565LeMosaic(frame, {
            width: CAMERA_PREVIEW_WIDTH,
            height: CAMERA_PREVIEW_HEIGHT,
            blockSize: PREVIEW_BLOCK_SIZE,
          })) {
            port.fillColor(toPiuColorString(block.color), block.x, block.y, block.width, block.height)
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

  const caption = new Label(null, {
    left: 0,
    right: 0,
    bottom: 8,
    height: 20,
    style: uiStyles().compact,
    string: options.caption ?? DEFAULT_CAPTION,
  })

  return new Container(
    { options },
    {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      active: true,
      backgroundTouch: true,
      skin: new Skin({ fill: DIALOG_BACKGROUND }),
      contents: [
        previewPort,
        caption,
        new ActionButton({ icon: 'close', onTap: options.onDismiss }, { right: 0, top: 0 }),
      ],
      Behavior: class extends Behavior {
        options: CameraPreviewOptions | null = null

        onCreate(_container: unknown, data: { options: CameraPreviewOptions }) {
          this.options = data.options
        }

        // Tapping anywhere on the dialog (outside the preview port) dismisses it.
        onTouchEnded() {
          this.options?.onDismiss?.()
        }

        // MainContentBehavior hooks (Face-independent lifecycle).
        onShow(container: { first?: { invalidate?: () => void } }) {
          container.first?.invalidate?.()
        }

        onHide() {
          this.options = null
        }

        onDispose() {
          this.options = null
        }
      },
    },
  ) as MainContent
}
