type AudioInputReader = {
  read(byteLength?: number): ArrayBuffer | undefined
}

const MAX_READ_BYTES = 2 * 1024

export function readAudioInputChunk(input: AudioInputReader, availableBytes: number): Uint8Array | undefined {
  const byteLength = Math.min(Math.max(0, Math.trunc(availableBytes)), MAX_READ_BYTES) & ~1
  if (byteLength === 0) return

  let buffer: ArrayBuffer | undefined
  try {
    buffer = input.read(byteLength)
  } catch (initialError) {
    try {
      buffer = input.read()
    } catch {
      throw initialError
    }
  }
  return buffer ? new Uint8Array(buffer) : undefined
}
