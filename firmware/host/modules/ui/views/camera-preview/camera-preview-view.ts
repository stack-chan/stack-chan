import {
  type CameraFrame,
  type CameraImageType,
  type MosaicBlock,
  sampleRgb565Mosaic,
  toPiuColorString,
} from 'camera-preview-utils'
import type { MainContent } from 'common-view'
import { localize } from 'localization'
import { Container, Label, type Port as PiuPort, Port, Skin } from 'piu/MC'
import { ActionButton } from 'ui-controls'
import { uiStyles } from 'ui-theme'

export const CAMERA_PREVIEW_WIDTH = 200
export const CAMERA_PREVIEW_HEIGHT = 120

export type CameraPreviewRenderMode = 'mosaic'
export type CameraPreviewOptions = {
  onRender?: (mode: CameraPreviewRenderMode) => void
  onDismiss?: () => void
  /** Caption drawn at the bottom of the full-area dialog. */
  caption?: string
}

export type CameraPreviewFrame = {
  width: number
  height: number
  imageType: CameraImageType
  blocks: MosaicBlock[]
}

// The preview sits centered on a full-area dialog background (60,60 centers 200x120 on a 320x240 screen).
const PREVIEW_LEFT = 60
const PREVIEW_TOP = 60
const PREVIEW_BLOCK_SIZE = 48
const PREVIEW_BACKGROUND = '#101010'
const DIALOG_BACKGROUND = '#000000'

export function prepareCameraPreviewFrame(frame: CameraFrame): CameraPreviewFrame {
  return {
    width: CAMERA_PREVIEW_WIDTH,
    height: CAMERA_PREVIEW_HEIGHT,
    imageType: frame.imageType,
    blocks: sampleRgb565Mosaic(frame, {
      width: CAMERA_PREVIEW_WIDTH,
      height: CAMERA_PREVIEW_HEIGHT,
      blockSize: PREVIEW_BLOCK_SIZE,
    }),
  }
}

/**
 * Build the camera preview as a full-area, Face-independent main component (MainContent).
 * It is mounted via `ui.setMain(...)` and dismissed via `ui.showFace()`; AppBar/Drawer stay active on top.
 */
export function createCameraPreviewDialog(
  preview: CameraPreviewFrame,
  options: CameraPreviewOptions = {},
): MainContent {
  const previewPort = new Port(
    { preview, options },
    {
      left: PREVIEW_LEFT,
      top: PREVIEW_TOP,
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

        onUndisplaying() {
          this.preview = null
          this.options = null
        }

        onDraw(port: PiuPort) {
          port.fillColor(PREVIEW_BACKGROUND, 0, 0, CAMERA_PREVIEW_WIDTH, CAMERA_PREVIEW_HEIGHT)
          const preview = this.preview
          if (!preview) return

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

  const caption = new Label(null, {
    left: 0,
    right: 0,
    bottom: 8,
    height: 20,
    style: uiStyles().compact,
    string: options.caption ?? localize('camera.caption'),
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
        new ActionButton({ icon: 'close', onTap: options.onDismiss }, { right: 0, top: 44 }),
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
