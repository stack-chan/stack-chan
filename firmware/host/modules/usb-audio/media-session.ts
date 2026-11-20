export enum StackChanControl {
  HELLO = 1,
  HELLO_ACK = 2,
  ERROR = 3,
  MIC_START = 16,
  MIC_STARTED = 17,
  MIC_STOP = 18,
  MIC_STOPPED = 19,
  SPEAKER_START = 32,
  SPEAKER_CREDIT = 33,
  SPEAKER_END = 34,
  SPEAKER_DONE = 35,
  SPEAKER_ABORT = 36,
  SPEAKER_TEXT = 37,
  STATUS = 48,
}

export enum StackChanErrorCode {
  INVALID_REQUEST = 1,
  INVALID_STREAM_DATA = 2,
  TRANSPORT_OVERFLOW = 3,
  AUDIO_OUTPUT = 4,
  BUSY = 5,
  SPEAKER_SEQUENCE_MISMATCH = 6,
  SPEAKER_BUFFER_OVERFLOW = 7,
  CAPTION_QUEUE_OVERFLOW = 8,
}

export enum StackChanStatus {
  IDLE = 0,
  RECOGNIZING = 1,
  SPEAKING = 2,
  LISTENING = 3,
  CONNECTING = 4,
  ERROR = 5,
}

export enum MediaSessionResult {
  ACCEPTED = 'accepted',
  IDEMPOTENT = 'idempotent',
  STALE = 'stale',
  INVALID = 'invalid',
  BUSY = 'busy',
}

export const StackChanCapability = {
  MICROPHONE_PCM: 1 << 0,
  SPEAKER_PCM: 1 << 1,
  SPEAKER_CREDIT: 1 << 2,
  SPEAKER_RATE_8000: 1 << 3,
  SPEAKER_RATE_16000: 1 << 4,
  SPEAKER_RATE_24000: 1 << 5,
  SPEAKER_TEXT: 1 << 6,
  DIAGNOSTICS: 1 << 7,
  STATUS_ICON: 1 << 8,
  STREAM_ID: 1 << 9,
  EVENT: 1 << 10,
  STATUS_EXTENDED: 1 << 11,
} as const

export const STACKCHAN_CAPABILITIES =
  StackChanCapability.MICROPHONE_PCM |
  StackChanCapability.SPEAKER_PCM |
  StackChanCapability.SPEAKER_CREDIT |
  StackChanCapability.SPEAKER_RATE_8000 |
  StackChanCapability.SPEAKER_RATE_16000 |
  StackChanCapability.SPEAKER_RATE_24000 |
  StackChanCapability.SPEAKER_TEXT |
  StackChanCapability.STATUS_ICON |
  StackChanCapability.STREAM_ID |
  StackChanCapability.EVENT |
  StackChanCapability.STATUS_EXTENDED

export const STACKCHAN_MICROPHONE_SAMPLE_RATE = 16000
export const STACKCHAN_SPEAKER_SAMPLE_RATES = [8000, 16000, 24000] as const

export const STACKCHAN_CONTROL_FRAME_INVARIANTS = {
  HELLO: { streamId: 'zero', sampleRate: 'ignored', payloadBytes: 'exactly 8' },
  MIC_START: { streamId: 'nonzero', sampleRate: '16000', payloadBytes: 'exactly 0' },
  MIC_STOP: { streamId: 'nonzero', sampleRate: '16000', payloadBytes: 'exactly 0' },
  SPEAKER_START: { streamId: 'nonzero', sampleRate: '8000, 16000, or 24000', payloadBytes: 'exactly 0' },
  SPEAKER_END: { streamId: 'current', sampleRate: 'current', payloadBytes: 'exactly 0' },
  SPEAKER_ABORT: { streamId: 'current', sampleRate: 'current', payloadBytes: 'exactly 0' },
  SPEAKER_TEXT: { streamId: 'current', sampleRate: 'current', payloadBytes: '1 through 1024' },
  STATUS: { streamId: 'zero', sampleRate: 'zero', payloadBytes: 'exactly 1' },
} as const

export function isValidStreamId(streamId: number): boolean {
  return Number.isInteger(streamId) && streamId > 0 && streamId <= 0xffff
}

export function isSupportedSpeakerSampleRate(sampleRate: number): boolean {
  return (
    sampleRate === STACKCHAN_SPEAKER_SAMPLE_RATES[0] ||
    sampleRate === STACKCHAN_SPEAKER_SAMPLE_RATES[1] ||
    sampleRate === STACKCHAN_SPEAKER_SAMPLE_RATES[2]
  )
}

export function isValidHelloControl(streamId: number, payloadBytes: number): boolean {
  return streamId === 0 && payloadBytes === 8
}

export function isValidMicrophoneControl(streamId: number, sampleRate: number, payloadBytes: number): boolean {
  return isValidStreamId(streamId) && sampleRate === STACKCHAN_MICROPHONE_SAMPLE_RATE && payloadBytes === 0
}

export function isValidSpeakerStartControl(streamId: number, sampleRate: number, payloadBytes: number): boolean {
  return isValidStreamId(streamId) && isSupportedSpeakerSampleRate(sampleRate) && payloadBytes === 0
}

export function isValidCurrentSpeakerControl(
  streamId: number,
  sampleRate: number,
  payloadBytes: number,
  currentStreamId: number,
  currentSampleRate: number,
): MediaSessionResult {
  if (currentStreamId === 0) return MediaSessionResult.INVALID
  if (streamId !== currentStreamId) return MediaSessionResult.STALE
  if (sampleRate !== currentSampleRate || payloadBytes !== 0) return MediaSessionResult.INVALID
  return MediaSessionResult.ACCEPTED
}

export function isValidStatusControl(
  streamId: number,
  sampleRate: number,
  payloadBytes: number,
  status: number,
  acceptedCapabilities: number,
): boolean {
  const maximumStatus =
    (acceptedCapabilities & StackChanCapability.STATUS_EXTENDED) !== 0
      ? StackChanStatus.ERROR
      : StackChanStatus.SPEAKING
  return (
    streamId === 0 &&
    sampleRate === 0 &&
    payloadBytes === 1 &&
    status >= StackChanStatus.IDLE &&
    status <= maximumStatus
  )
}

export function isWithinSpeakerCredit(payloadBytes: number, outstandingCreditBytes: number): boolean {
  return payloadBytes >= 0 && outstandingCreditBytes >= 0 && payloadBytes <= outstandingCreditBytes
}
