export type MultipartPart = ArrayBuffer | HostBuffer | Uint8Array

export function createMultipartUpload(parts: readonly MultipartPart[]) {
  let index = 0
  let offset = 0
  return {
    byteLength: parts.reduce((length, part) => length + part.byteLength, 0),
    write(writer: { write(data: MultipartPart | DataView): number }, available: number): void {
      while (index < parts.length && parts[index].byteLength === offset) {
        index++
        offset = 0
      }
      if (available <= 0 || index === parts.length) return
      const part = parts[index]
      // TLSのレコードには暗号化のオーバーヘッドがある。次の書き込み可能量はonWritableで受け取る。
      const size = Math.min(available, 4096, part.byteLength - offset)
      if (offset === 0 && size === part.byteLength) writer.write(part)
      else if (ArrayBuffer.isView(part)) writer.write(new DataView(part.buffer, part.byteOffset + offset, size))
      else writer.write(new DataView(part as ArrayBuffer, offset, size))
      offset += size
    },
  }
}
