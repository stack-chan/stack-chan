export function encodeUTF8(value: string): Uint8Array {
  const bytes: number[] = []
  for (let index = 0; index < value.length; index += 1) {
    let codePoint = value.charCodeAt(index)
    if (codePoint >= 0xd800 && codePoint <= 0xdbff) {
      const low = value.charCodeAt(index + 1)
      if (low >= 0xdc00 && low <= 0xdfff) {
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (low - 0xdc00)
        index += 1
      } else {
        codePoint = 0xfffd
      }
    } else if (codePoint >= 0xdc00 && codePoint <= 0xdfff) {
      codePoint = 0xfffd
    }

    if (codePoint <= 0x7f) {
      bytes.push(codePoint)
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f))
    } else if (codePoint <= 0xffff) {
      bytes.push(0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f))
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      )
    }
  }
  return Uint8Array.from(bytes)
}

export function decodeUTF8(bytes: Uint8Array): string {
  let result = ''
  for (let index = 0; index < bytes.length; ) {
    const first = bytes[index++]
    let codePoint = 0xfffd
    let continuationCount = 0
    let minimum = 0

    if (first <= 0x7f) {
      codePoint = first
    } else if ((first & 0xe0) === 0xc0) {
      codePoint = first & 0x1f
      continuationCount = 1
      minimum = 0x80
    } else if ((first & 0xf0) === 0xe0) {
      codePoint = first & 0x0f
      continuationCount = 2
      minimum = 0x800
    } else if ((first & 0xf8) === 0xf0) {
      codePoint = first & 0x07
      continuationCount = 3
      minimum = 0x10000
    }

    let valid = continuationCount === 0 || codePoint !== 0xfffd
    for (let offset = 0; offset < continuationCount; offset += 1) {
      const next = bytes[index]
      if (next == null || (next & 0xc0) !== 0x80) {
        valid = false
        break
      }
      index += 1
      codePoint = (codePoint << 6) | (next & 0x3f)
    }

    if (
      !valid ||
      (minimum !== 0 && codePoint < minimum) ||
      codePoint > 0x10ffff ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
    ) {
      result += '\ufffd'
    } else if (codePoint <= 0xffff) {
      result += String.fromCharCode(codePoint)
    } else {
      const value = codePoint - 0x10000
      result += String.fromCharCode(0xd800 | (value >> 10), 0xdc00 | (value & 0x3ff))
    }
  }
  return result
}

export function fnv1a32(value: string): number {
  let hash = 0x811c9dc5
  for (const byte of encodeUTF8(value)) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}

export function copyArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}
