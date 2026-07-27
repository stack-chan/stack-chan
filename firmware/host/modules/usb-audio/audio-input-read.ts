type AudioInputReader = {
  read(byteLength?: number): ArrayBuffer | undefined
}

const MAX_READ_BYTES = 2 * 1024

export function readAudioInputChunk(input: AudioInputReader, availableBytes: number): Uint8Array | undefined {
  const byteLength = Math.min(Math.max(0, Math.trunc(availableBytes)), MAX_READ_BYTES) & ~1
  if (byteLength === 0) return

  let buffer: ArrayBuffer | undefined
  let requestedByteLength = byteLength
  try {
    buffer = input.read(byteLength)
  } catch (initialError) {
    let recovered = false
    while (requestedByteLength >= 2) {
      requestedByteLength = Math.max(2, (requestedByteLength >> 1) & ~1)
      try {
        buffer = input.read(requestedByteLength)
        recovered = true
        break
      } catch {
        if (requestedByteLength === 2) break
      }
    }
    if (!recovered) throw initialError
  }
  if (!buffer) return
  const boundedByteLength = Math.min(buffer.byteLength, requestedByteLength) & ~1
  return boundedByteLength > 0 ? new Uint8Array(buffer, 0, boundedByteLength) : undefined
}
