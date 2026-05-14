import type { CameraFrame } from './camera.js'
import { sampleRgb565LeMosaic } from './camera-preview-utils.js'

import Bitmap from 'commodetto/Bitmap'
import { Container, type Container as PiuContainer, type Port as PiuPort } from 'piu/MC'
import RuntimeBitmapPort from 'runtime-bitmap-port'

export const CAMERA_PREVIEW_WIDTH = 200
export const CAMERA_PREVIEW_HEIGHT = 120

export type CameraPreviewRenderMode = 'runtime-bitmap-port' | 'texture' | 'bitmap' | 'mosaic'
export type CameraPreviewOptions = {
  onRender?: (mode: CameraPreviewRenderMode) => void
}

const PREVIEW_LEFT = 60
const PREVIEW_TOP = 60
const PREVIEW_BLOCK_SIZE = 48
const PREVIEW_BACKGROUND = '#101010'
const ENABLE_RUNTIME_TEXTURE_PREVIEW = false

type BitmapPort = PiuPort & {
  drawTexture?: (
    texture: unknown,
    color: string,
    x: number,
    y: number,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
  ) => void
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

type RuntimeTextureConstructor = new (it?: unknown, alphaBitmap?: Bitmap, colorBitmap?: Bitmap) => unknown

type RuntimeTexturePreview = {
  buffer: ArrayBuffer
  bitmap: Bitmap
  texture: unknown
}

function piuColor(color: number): string {
  const hex = color.toString(16).padStart(6, '0')
  return `#${hex}`
}

function canDrawFrameAsBitmap(frame: CameraFrame): boolean {
  return frame.imageType === 'rgb565le' && frame.buffer.byteLength >= frame.width * frame.height * 2
}

function copyRgb565LeToBeBuffer(frame: CameraFrame): ArrayBuffer {
  const source = new Uint8Array(frame.buffer)
  const length = frame.width * frame.height * 2
  const buffer = new ArrayBuffer(length)
  const target = new Uint8Array(buffer)

  for (let index = 0; index < length; index += 2) {
    target[index] = source[index + 1]
    target[index + 1] = source[index]
  }

  return buffer
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

function createRgb565TexturePreview(frame: CameraFrame): RuntimeTexturePreview | undefined {
  if (!ENABLE_RUNTIME_TEXTURE_PREVIEW) return undefined
  if (!canDrawFrameAsBitmap(frame)) return undefined

  const Texture = (globalThis as { Texture?: RuntimeTextureConstructor }).Texture
  if (!Texture) return undefined

  const buffer = copyRgb565LeToBeBuffer(frame)
  const bitmap = new Bitmap(frame.width, frame.height, Bitmap.RGB565BE, buffer, 0)
  return {
    buffer,
    bitmap,
    texture: new Texture(null, undefined, bitmap),
  }
}

function drawRgb565Texture(port: BitmapPort, preview: RuntimeTexturePreview | undefined, frame: CameraFrame): boolean {
  if (!port.drawTexture || !canDrawFrameAsBitmap(frame)) return false
  if (!preview) return false

  try {
    port.drawTexture(
      preview.texture,
      'white',
      0,
      0,
      0,
      0,
      Math.min(frame.width, CAMERA_PREVIEW_WIDTH),
      Math.min(frame.height, CAMERA_PREVIEW_HEIGHT),
    )
    return true
  } catch {
    return false
  }
}

export function createCameraPreviewFace(frame: CameraFrame, options: CameraPreviewOptions = {}): PiuContainer {
  const previewPort = new RuntimeBitmapPort(
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
        texturePreview: RuntimeTexturePreview | undefined

        onCreate(_port: PiuPort, data: { frame: CameraFrame; options: CameraPreviewOptions }) {
          this.frame = data.frame
          this.options = data.options
          this.texturePreview = createRgb565TexturePreview(data.frame)
        }

        onDisplaying(port: PiuPort) {
          port.invalidate()
        }

        onDraw(port: PiuPort) {
          port.fillColor(PREVIEW_BACKGROUND, 0, 0, CAMERA_PREVIEW_WIDTH, CAMERA_PREVIEW_HEIGHT)
          const frame = this.frame
          if (!frame) return

          if (drawRgb565Texture(port as BitmapPort, this.texturePreview, frame)) {
            this.reportRenderMode('texture')
            return
          }

          if (drawRgb565Bitmap(port as BitmapPort, frame)) {
            this.reportRenderMode('runtime-bitmap-port')
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
