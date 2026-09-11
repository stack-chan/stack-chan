import { parsePcmWave } from 'pcm-wave'
import type { AudioData, RecordedAudio } from 'stackchan/audio'
import { StackchanError } from 'stackchan/errors'
import { MAX_PLAYBACK_BYTES } from 'stackchan-contracts/audio-playback'
import { MAX_RECORDING_BYTES } from 'stackchan-contracts/audio-recording'

export function isWaveMimeType(mimeType: string): boolean {
  return ['audio/wav', 'audio/wave', 'audio/x-wav'].includes(mimeType.split(';', 1)[0].trim().toLowerCase())
}

export function validateAudioData(audio: AudioData): void {
  if (
    !audio ||
    !(audio.data instanceof ArrayBuffer) ||
    !audio.data.byteLength ||
    audio.data.byteLength > MAX_PLAYBACK_BYTES
  )
    throw new StackchanError('INVALID_ARGUMENT', 'Audio must contain 1 byte to 3 MiB of encoded data')
  if (
    typeof audio.mimeType !== 'string' ||
    audio.mimeType.length > 256 ||
    !/^audio\/[a-z0-9!#$&^_.+-]+(?:\s*;[^\r\n\0]*)?$/i.test(audio.mimeType)
  )
    throw new StackchanError('INVALID_ARGUMENT', 'Audio needs its actual audio MIME type')
}

/** Expose metadata alongside, rather than as hidden properties on, the owned recording bytes. */
export function recordedAudio(buffer: ArrayBuffer, simulated: boolean): RecordedAudio {
  try {
    if (!(buffer instanceof ArrayBuffer) || !buffer.byteLength || buffer.byteLength > MAX_RECORDING_BYTES)
      throw new Error('Microphone returned an invalid recording size')
    const metadata = buffer as ArrayBuffer & { mimeType?: string; filename?: string }
    const mimeType = simulated ? metadata.mimeType : 'audio/wav'
    const filename = simulated ? metadata.filename : 'recording.wav'
    if (typeof filename !== 'string' || !filename.length || filename.length > 255 || /[\r\n\0/\\]/.test(filename))
      throw new Error('Microphone returned an invalid recording filename')
    if (typeof mimeType !== 'string') throw new Error('Microphone returned no recording MIME type')
    const result: RecordedAudio = { data: buffer, mimeType, filename }
    validateAudioData(result)
    if (!simulated) parsePcmWave(buffer)
    return Object.freeze(result)
  } catch (cause) {
    throw new StackchanError('IO', 'Microphone returned invalid recording data or format', { cause })
  }
}
