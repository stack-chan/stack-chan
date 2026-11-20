export type CameraImageType = 'rgb565le' | 'rgb565be' | 'yuv422' | 'jpeg'

export type CameraFrame = {
  width: number
  height: number
  imageType: CameraImageType
  buffer: ArrayBuffer
  close?: () => void
}

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

export type FrameCopyOptions = {
  width: number
  height: number
  byteOrder?: 'le' | 'be'
}

const HEX_DIGITS = '0123456789abcdef'

function hexByte(value: number): string {
  const byte = value & 0xff
  return `${HEX_DIGITS[(byte >> 4) & 0x0f]}${HEX_DIGITS[byte & 0x0f]}`
}

export function toPiuColorString(color: number): string {
  return `#${hexByte(color >> 16)}${hexByte(color >> 8)}${hexByte(color)}`
}

function isRgb565ImageType(imageType: CameraImageType): imageType is 'rgb565le' | 'rgb565be' {
  return imageType === 'rgb565le' || imageType === 'rgb565be'
}

function byteOrderForImageType(imageType: CameraImageType): 'le' | 'be' {
  return imageType === 'rgb565be' ? 'be' : 'le'
}

export function rgb565ToPiuColor(buffer: ArrayBuffer, byteOffset: number, byteOrder: 'le' | 'be' = 'le'): number {
  const view = new Uint8Array(buffer)
  const pixel =
    byteOrder === 'be' ? (view[byteOffset] << 8) | view[byteOffset + 1] : view[byteOffset] | (view[byteOffset + 1] << 8)
  const red5 = (pixel >> 11) & 0x1f
  const green6 = (pixel >> 5) & 0x3f
  const blue5 = pixel & 0x1f
  const red = (red5 << 3) | (red5 >> 2)
  const green = (green6 << 2) | (green6 >> 4)
  const blue = (blue5 << 3) | (blue5 >> 2)

  return (red << 16) | (green << 8) | blue
}

export function rgb565LeToPiuColor(buffer: ArrayBuffer, byteOffset: number): number {
  return rgb565ToPiuColor(buffer, byteOffset, 'le')
}

function clampSampleCoordinate(value: number, maxExclusive: number): number {
  const coordinate = value | 0
  if (coordinate < 0) return 0
  if (coordinate >= maxExclusive) return maxExclusive - 1
  return coordinate
}

export function sampleRgb565Mosaic(frame: CameraFrame, options: MosaicOptions): MosaicBlock[] {
  if (!isRgb565ImageType(frame.imageType) || frame.width <= 0 || frame.height <= 0) {
    return []
  }

  const byteOrder = byteOrderForImageType(frame.imageType)
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
        color: rgb565ToPiuColor(frame.buffer, byteOffset, byteOrder),
      })
    }
  }

  return blocks
}

export function sampleRgb565LeMosaic(frame: CameraFrame, options: MosaicOptions): MosaicBlock[] {
  return frame.imageType === 'rgb565le' ? sampleRgb565Mosaic(frame, options) : []
}

export function copyRgb565Frame(frame: CameraFrame, options: FrameCopyOptions): ArrayBuffer {
  const targetWidth = Math.max(1, options.width | 0)
  const targetHeight = Math.max(1, options.height | 0)
  const targetByteOrder = options.byteOrder ?? byteOrderForImageType(frame.imageType)
  const sourceByteOrder = byteOrderForImageType(frame.imageType)
  const swapBytes = sourceByteOrder !== targetByteOrder
  const target = new Uint8Array(targetWidth * targetHeight * 2)
  if (!isRgb565ImageType(frame.imageType) || frame.width <= 0 || frame.height <= 0) {
    return target.buffer
  }

  const source = new Uint8Array(frame.buffer)
  const requiredBytes = frame.width * frame.height * 2
  if (source.byteLength < requiredBytes) {
    return target.buffer
  }

  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = clampSampleCoordinate((y * frame.height) / targetHeight, frame.height)
    const targetRow = y * targetWidth * 2
    const sourceRow = sourceY * frame.width * 2

    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = clampSampleCoordinate((x * frame.width) / targetWidth, frame.width)
      const sourceOffset = sourceRow + sourceX * 2
      const targetOffset = targetRow + x * 2
      if (swapBytes) {
        target[targetOffset] = source[sourceOffset + 1]
        target[targetOffset + 1] = source[sourceOffset]
      } else {
        target[targetOffset] = source[sourceOffset]
        target[targetOffset + 1] = source[sourceOffset + 1]
      }
    }
  }

  return target.buffer
}

export function copyRgb565LeFrame(frame: CameraFrame, options: FrameCopyOptions): ArrayBuffer {
  if (frame.imageType === 'rgb565le') return copyRgb565Frame(frame, options)
  const targetWidth = Math.max(1, options.width | 0)
  const targetHeight = Math.max(1, options.height | 0)
  return new ArrayBuffer(targetWidth * targetHeight * 2)
}
