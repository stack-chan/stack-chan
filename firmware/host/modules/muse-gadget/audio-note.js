const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
export const audioNoteFormat = Object.freeze({ encoding: 'pcm_s16le', sampleRate: 16000, channels: 1 })
export const audioNoteMaxPcmBytes = 16000 * 2 * 15

function identifier(value, name) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error(`invalid ${name}`)
  return value
}

export function wavHeader(pcmByteLength) {
  if (
    !Number.isInteger(pcmByteLength) ||
    pcmByteLength < 2 ||
    pcmByteLength > audioNoteMaxPcmBytes ||
    pcmByteLength % 2
  )
    throw new Error('voice note requires 1 to 240000 PCM16 samples')
  const bytes = new Uint8Array(44)
  const view = new DataView(bytes.buffer)
  for (const [offset, text] of [
    [0, 'RIFF'],
    [8, 'WAVE'],
    [12, 'fmt '],
    [36, 'data'],
  ]) {
    for (let index = 0; index < text.length; index++) bytes[offset + index] = text.charCodeAt(index)
  }
  view.setUint32(4, pcmByteLength + 36, true)
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, 16000, true)
  view.setUint32(28, 32000, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  view.setUint32(40, pcmByteLength, true)
  return bytes
}

// The caller retains immutable PCM until this iterator is exhausted or abandoned.
export function createAudioNoteBody(
  pcm,
  { nodeId, sessionId, outputModality = 'voice', chunkChars = 4096 },
  { encodeBase64 } = {},
) {
  if (encodeBase64 !== undefined && typeof encodeBase64 !== 'function') throw new Error('invalid base64 encoder')
  if (!(pcm instanceof Uint8Array)) throw new Error('PCM must be Uint8Array')
  const header = wavHeader(pcm.byteLength)
  identifier(nodeId, 'nodeId')
  identifier(sessionId, 'sessionId')
  if (outputModality !== 'voice' && outputModality !== 'text') throw new Error('invalid output modality')
  if (!Number.isInteger(chunkChars) || chunkChars < 4 || chunkChars > 4096 || chunkChars % 4)
    throw new Error('invalid base64 chunk size')
  const metadata = JSON.stringify({
    message: '',
    device_id: nodeId,
    session_id: sessionId,
    device: 'mcu-wearable',
    output_modality: outputModality,
  })
  const head = `${metadata.slice(0, -1)},"items":[{"type":"file","mime_type":"audio/wav","filename":"voice_note.wav","data_base64":"`
  const tail = '"}]}'
  const size = header.byteLength + pcm.byteLength
  const byte = (index) => (index < header.byteLength ? header[index] : pcm[index - header.byteLength])
  return {
    byteLength: head.length + Math.ceil(size / 3) * 4 + tail.length,
    *[Symbol.iterator]() {
      yield head
      if (encodeBase64) {
        const raw = new Uint8Array((chunkChars / 4) * 3)
        for (let offset = 0; offset < size;) {
          const count = Math.min(raw.length, size - offset)
          const headerCount = Math.max(0, Math.min(count, header.length - offset))
          if (headerCount) raw.set(header.subarray(offset, offset + headerCount))
          if (headerCount < count) {
            const pcmOffset = offset + headerCount - header.length
            raw.set(pcm.subarray(pcmOffset, pcmOffset + count - headerCount), headerCount)
          }
          const chunk = encodeBase64(raw.subarray(0, count))
          if (typeof chunk !== 'string' || chunk.length !== Math.ceil(count / 3) * 4)
            throw new Error('invalid base64 encoder result')
          offset += count
          yield chunk
        }
        yield tail
        return
      }
      for (let offset = 0; offset < size; ) {
        let chunk = ''
        while (offset < size && chunk.length < chunkChars) {
          const remaining = size - offset
          const a = byte(offset++)
          const b = remaining > 1 ? byte(offset++) : 0
          const c = remaining > 2 ? byte(offset++) : 0
          chunk +=
            alphabet[a >> 2] +
            alphabet[((a & 3) << 4) | (b >> 4)] +
            (remaining > 1 ? alphabet[((b & 15) << 2) | (c >> 6)] : '=') +
            (remaining > 2 ? alphabet[c & 63] : '=')
        }
        yield chunk
      }
      yield tail
    },
  }
}
