import { finiteNumber, StackchanError } from 'stackchan/errors'

export const DEFAULT_RECORDING_DURATION_MS = 3_000
export const MAX_RECORDING_DURATION_MS = 15_000
export const MAX_RECORDING_BYTES = 512 * 1024
export const RECORDING_GRACE_MS = 1_000

export function validateRecordingDuration(durationMs: number): void {
  finiteNumber(durationMs, 'durationMs', 1, MAX_RECORDING_DURATION_MS)
}

type PcmFormat = { sampleRate: number; channels: number; bitsPerSample: number }

/** One bounded PCM WAV allocation. The caller fills every frame before returning it. */
export function createRecordingWave(format: PcmFormat, durationMs: number) {
  validateRecordingDuration(durationMs)
  const { sampleRate, channels, bitsPerSample } = format
  if (
    !Number.isInteger(sampleRate) ||
    sampleRate < 1 ||
    sampleRate > 192_000 ||
    (channels !== 1 && channels !== 2) ||
    (bitsPerSample !== 8 && bitsPerSample !== 16)
  )
    throw new StackchanError('IO', 'Unsupported microphone PCM format')
  const bytesPerFrame = channels * (bitsPerSample / 8)
  const dataBytes = Math.ceil((sampleRate * durationMs) / 1_000) * bytesPerFrame
  if (dataBytes + 44 > MAX_RECORDING_BYTES)
    throw new StackchanError('INVALID_ARGUMENT', 'Recording exceeds the 512 KiB buffer limit; shorten durationMs')
  const buffer = new ArrayBuffer(44 + dataBytes)
  const header = new DataView(buffer)
  header.setUint32(0, 0x52494646) // RIFF
  header.setUint32(4, 36 + dataBytes, true)
  header.setUint32(8, 0x57415645) // WAVE
  header.setUint32(12, 0x666d7420) // fmt
  header.setUint32(16, 16, true)
  header.setUint16(20, 1, true) // PCM
  header.setUint16(22, channels, true)
  header.setUint32(24, sampleRate, true)
  header.setUint32(28, sampleRate * bytesPerFrame, true)
  header.setUint16(32, bytesPerFrame, true)
  header.setUint16(34, bitsPerSample, true)
  header.setUint32(36, 0x64617461) // data
  header.setUint32(40, dataBytes, true)
  return { buffer, samples: new Uint8Array(buffer, 44), bytesPerFrame }
}
