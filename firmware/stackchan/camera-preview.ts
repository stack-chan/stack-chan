import type { CameraFrame } from './camera.js'
import { sampleRgb565LeMosaic } from './camera-preview-utils.js'

import { Container, Port, type Container as PiuContainer, type Port as PiuPort } from 'piu/MC'

const PREVIEW_LEFT = 60
const PREVIEW_TOP = 60
const PREVIEW_WIDTH = 200
const PREVIEW_HEIGHT = 120
const PREVIEW_BLOCK_SIZE = 48
const PREVIEW_BACKGROUND = '#101010'

function piuColor(color: number): string {
  const hex = color.toString(16).padStart(6, '0')
  return `#${hex}`
}

export function createCameraPreviewFace(frame: CameraFrame): PiuContainer {
  const previewPort = new Port(
    { frame },
    {
      left: 0,
      top: 0,
      width: PREVIEW_WIDTH,
      height: PREVIEW_HEIGHT,
      Behavior: class extends Behavior {
        frame: CameraFrame | null = null

        onCreate(_port: PiuPort, data: { frame: CameraFrame }) {
          this.frame = data.frame
        }

        onDisplaying(port: PiuPort) {
          port.invalidate()
        }

        onDraw(port: PiuPort) {
          port.fillColor(PREVIEW_BACKGROUND, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT)
          const frame = this.frame
          if (!frame) return

          for (const block of sampleRgb565LeMosaic(frame, {
            width: PREVIEW_WIDTH,
            height: PREVIEW_HEIGHT,
            blockSize: PREVIEW_BLOCK_SIZE,
          })) {
            port.fillColor(piuColor(block.color), block.x, block.y, block.width, block.height)
          }
        }
      },
    },
  )

  return new Container(null, {
    left: PREVIEW_LEFT,
    top: PREVIEW_TOP,
    width: PREVIEW_WIDTH,
    height: PREVIEW_HEIGHT,
    contents: [previewPort],
  })
}
