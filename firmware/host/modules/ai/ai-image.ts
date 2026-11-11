import type { Image } from '../voice/contracts.js'

const signature = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10)
const crcTable = new Uint32Array(256)
for (let i = 0; i < 256; i++) {
  let crc = i
  for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  crcTable[i] = crc
}

function u32(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value >>> 24
  bytes[offset + 1] = value >>> 16
  bytes[offset + 2] = value >>> 8
  bytes[offset + 3] = value
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const result = new Uint8Array(data.length + 12)
  u32(result, 0, data.length)
  for (let i = 0; i < 4; i++) result[4 + i] = type.charCodeAt(i)
  result.set(data, 8)
  let crc = 0xffffffff
  for (let i = 4; i < result.length - 4; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ result[i]) & 255]
  u32(result, result.length - 4, ~crc)
  return result
}

export interface ImageBytes {
  mime: string
  length: number
  read(): Iterable<Uint8Array>
}

export function encodedImage(image: Image): ImageBytes {
  if (image.format === 'jpeg' || image.format === 'png') {
    return {
      mime: 'image/' + image.format,
      length: image.data.length,
      *read() {
        for (let i = 0; i < image.data.length; i += 768) yield image.data.subarray(i, i + 768)
      },
    }
  }
  const { width, height, data } = image as Extract<Image, { width: number }>
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 1024 ||
    height > 1024 ||
    data.length !== width * height * 2
  )
    throw RangeError('invalid RGB565 frame')
  const rowLength = 1 + width * 3
  const len = 8 + 25 + 14 + height * (12 + 5 + rowLength) + 16 + 12
  return {
    mime: 'image/png',
    length: len,
    *read() {
      yield signature
      const ihdr = Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0, 8, 2, 0, 0, 0)
      u32(ihdr, 0, width)
      u32(ihdr, 4, height)
      yield chunk('IHDR', ihdr)
      yield chunk('IDAT', Uint8Array.of(0x78, 0x01))
      let a = 1,
        b = 0
      for (let y = 0; y < height; y++) {
        // 1走査線ずつ非圧縮DEFLATE blockにすると画像全体の変換領域が要らない
        const row = new Uint8Array(5 + rowLength)
        row[0] = y === height - 1 ? 1 : 0
        row[1] = rowLength
        row[2] = rowLength >>> 8
        row[3] = ~rowLength
        row[4] = ~rowLength >>> 8
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 2
          const word = image.format === 'rgb565le' ? data[i] | (data[i + 1] << 8) : (data[i] << 8) | data[i + 1]
          const red = word >>> 11,
            green = (word >>> 5) & 63,
            blue = word & 31
          row[6 + x * 3] = (red << 3) | (red >>> 2)
          row[7 + x * 3] = (green << 2) | (green >>> 4)
          row[8 + x * 3] = (blue << 3) | (blue >>> 2)
        }
        for (let i = 5; i < row.length; i++) {
          a = (a + row[i]) % 65521
          b = (b + a) % 65521
        }
        yield chunk('IDAT', row)
      }
      const adler = new Uint8Array(4)
      u32(adler, 0, (b << 16) | a)
      yield chunk('IDAT', adler)
      yield chunk('IEND', new Uint8Array(0))
    },
  }
}

const digits = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
export function* base64(source: Iterable<Uint8Array>): Generator<Uint8Array> {
  let bits = 0,
    value = 0,
    used = 0
  let out = new Uint8Array(1024)
  for (const part of source) {
    for (const byte of part) {
      value = (value << 8) | byte
      bits += 8
      while (bits >= 6) {
        bits -= 6
        out[used++] = digits.charCodeAt((value >>> bits) & 63)
        if (used === out.length) {
          yield out
          out = new Uint8Array(1024)
          used = 0
        }
      }
    }
  }
  if (bits) {
    out[used++] = digits.charCodeAt((value << (6 - bits)) & 63)
    while (used % 4 !== 0) out[used++] = 61
  }
  if (used) yield out.subarray(0, used)
}
