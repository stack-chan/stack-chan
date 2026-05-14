import type { CameraFrame } from './camera.js'

export type MosaicBlock = {
  x: number
  y: number
  width: number
  height: number
  color: number
}

export type MosaicOptions = {
  width: number
  height: number
  blockSize: number
}

export function rgb565LeToPiuColor(buffer: ArrayBuffer, byteOffset: number): number {
  const view = new Uint8Array(buffer)
  const pixel = view[byteOffset] | (view[byteOffset + 1] << 8)
  const red5 = (pixel >> 11) & 0x1f
  const green6 = (pixel >> 5) & 0x3f
  const blue5 = pixel & 0x1f
  const red = (red5 << 3) | (red5 >> 2)
  const green = (green6 << 2) | (green6 >> 4)
  const blue = (blue5 << 3) | (blue5 >> 2)

  return (red << 16) | (green << 8) | blue
}

function clampSampleCoordinate(value: number, maxExclusive: number): number {
  const coordinate = value | 0
  if (coordinate < 0) return 0
  if (coordinate >= maxExclusive) return maxExclusive - 1
  return coordinate
}

export function sampleRgb565LeMosaic(frame: CameraFrame, options: MosaicOptions): MosaicBlock[] {
  if (frame.imageType !== 'rgb565le' || frame.width <= 0 || frame.height <= 0) {
    return []
  }

  const blockSize = Math.max(1, options.blockSize | 0)
  const targetWidth = Math.max(1, options.width | 0)
  const targetHeight = Math.max(1, options.height | 0)
  const blocks: MosaicBlock[] = []

  for (let y = 0; y < targetHeight; y += blockSize) {
    const height = Math.min(blockSize, targetHeight - y)
    const sampleY = clampSampleCoordinate(((y + height / 2) * frame.height) / targetHeight, frame.height)

    for (let x = 0; x < targetWidth; x += blockSize) {
      const width = Math.min(blockSize, targetWidth - x)
      const sampleX = clampSampleCoordinate(((x + width / 2) * frame.width) / targetWidth, frame.width)
      const byteOffset = (sampleY * frame.width + sampleX) * 2

      blocks.push({
        x,
        y,
        width,
        height,
        color: rgb565LeToPiuColor(frame.buffer, byteOffset),
      })
    }
  }

  return blocks
}
