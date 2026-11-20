export const STACKCHAN_DIAGNOSTICS_VERSION = 1
export const STACKCHAN_DIAGNOSTICS_PAYLOAD_BYTES = 52

export enum StackChanDiagnosticEvent {
  SESSION_STARTED = 1,
  AUDIO_STARTED = 2,
  SNAPSHOT = 3,
  COMPLETED = 4,
  ABORTED = 5,
}

export const StackChanDiagnosticFlag = {
  AUDIO_ACTIVE: 1 << 0,
  SPEAKER_ENDED: 1 << 1,
  AWAITING_DRAIN: 1 << 2,
  BUFFER_EMPTY: 1 << 3,
  STARVING: 1 << 4,
} as const

export type StackChanSpeakerDiagnostics = {
  event: StackChanDiagnosticEvent
  flags: number
  ticks: number
  sampleRate: number
  queuedBytes: number
  writableBytes: number
  receivedBytes: number
  writtenBytes: number
  receivedFrames: number
  writableCallbacks: number
  starvationEvents: number
  maxReceiveGapMilliseconds: number
  maxWritableGapMilliseconds: number
  txQueueBytes: number
}

/** Encode a fixed-size, little-endian speaker diagnostic snapshot. */
export function encodeSpeakerDiagnostics(snapshot: StackChanSpeakerDiagnostics): Uint8Array {
  const payload = new Uint8Array(STACKCHAN_DIAGNOSTICS_PAYLOAD_BYTES)
  const view = new DataView(payload.buffer)
  view.setUint8(0, STACKCHAN_DIAGNOSTICS_VERSION)
  view.setUint8(1, snapshot.event)
  view.setUint16(2, snapshot.flags, true)
  view.setUint32(4, snapshot.ticks >>> 0, true)
  view.setUint32(8, snapshot.sampleRate >>> 0, true)
  view.setUint32(12, snapshot.queuedBytes >>> 0, true)
  view.setUint32(16, snapshot.writableBytes >>> 0, true)
  view.setUint32(20, snapshot.receivedBytes >>> 0, true)
  view.setUint32(24, snapshot.writtenBytes >>> 0, true)
  view.setUint32(28, snapshot.receivedFrames >>> 0, true)
  view.setUint32(32, snapshot.writableCallbacks >>> 0, true)
  view.setUint32(36, snapshot.starvationEvents >>> 0, true)
  view.setUint32(40, snapshot.maxReceiveGapMilliseconds >>> 0, true)
  view.setUint32(44, snapshot.maxWritableGapMilliseconds >>> 0, true)
  view.setUint32(48, snapshot.txQueueBytes >>> 0, true)
  return payload
}
