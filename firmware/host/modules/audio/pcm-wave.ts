import { StackchanError } from 'stackchan/errors'
import { MAX_PLAYBACK_BYTES, MAX_PLAYBACK_DURATION_MS } from 'stackchan-contracts/audio-playback'

export type PcmWave = {
  sampleRate: number
  numChannels: number
  bitsPerSample: 16
  dataOffset: number
  dataBytes: number
  frames: number
  durationMs: number
}

function invalid(message: string): never {
  throw new StackchanError('INVALID_ARGUMENT', message)
}

/** Validate one complete PCM WAVE without copying or acquiring an audio device. */
export function parsePcmWave(buffer: ArrayBuffer): PcmWave {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 44 || buffer.byteLength > MAX_PLAYBACK_BYTES)
    invalid('WAV buffer is empty or exceeds playback limits')
  const view = new DataView(buffer)
  if (view.getUint32(0) !== 0x52494646 || view.getUint32(8) !== 0x57415645) invalid('Expected a RIFF WAVE buffer')
  if (view.getUint32(4, true) + 8 !== buffer.byteLength) invalid('RIFF length does not match the buffer')
  let formatOffset: number | undefined
  let dataOffset: number | undefined
  let dataBytes = 0
  let chunks = 0
  for (let offset = 12; offset < buffer.byteLength; ) {
    if (++chunks > 256) invalid('WAV contains too many chunks')
    if (offset + 8 > buffer.byteLength) invalid('Incomplete WAV chunk header')
    const tag = view.getUint32(offset)
    const size = view.getUint32(offset + 4, true)
    const start = offset + 8
    const end = start + size
    const paddedEnd = end + (size & 1)
    if (paddedEnd > buffer.byteLength) invalid('WAV chunk exceeds its containing RIFF')
    if (tag === 0x666d7420) {
      if (formatOffset !== undefined || size < 16) invalid('WAV needs one complete format chunk')
      formatOffset = start
    } else if (tag === 0x64617461) {
      if (dataOffset !== undefined) invalid('Multiple WAV data chunks are unsupported')
      dataOffset = start
      dataBytes = size
    }
    offset = paddedEnd
  }
  if (formatOffset === undefined || dataOffset === undefined || !dataBytes) invalid('WAV has no format or audio data')
  const format = view.getUint16(formatOffset, true)
  const numChannels = view.getUint16(formatOffset + 2, true)
  const sampleRate = view.getUint32(formatOffset + 4, true)
  const byteRate = view.getUint32(formatOffset + 8, true)
  const blockAlign = view.getUint16(formatOffset + 12, true)
  const bits = view.getUint16(formatOffset + 14, true)
  if (
    format !== 1 ||
    bits !== 16 ||
    (numChannels !== 1 && numChannels !== 2) ||
    sampleRate < 8000 ||
    sampleRate > 48000
  )
    throw new StackchanError('UNSUPPORTED', 'Playback requires 16-bit PCM WAV, 8–48 kHz, mono or stereo')
  if (blockAlign !== numChannels * 2 || byteRate !== sampleRate * blockAlign || dataBytes % blockAlign !== 0)
    invalid('WAV PCM frame size or byte rate is inconsistent')
  const frames = dataBytes / blockAlign
  const durationMs = (frames * 1000) / sampleRate
  if (durationMs > MAX_PLAYBACK_DURATION_MS) invalid('WAV exceeds the playback duration limit')
  return { sampleRate, numChannels, bitsPerSample: 16, dataOffset, dataBytes, frames, durationMs }
}
