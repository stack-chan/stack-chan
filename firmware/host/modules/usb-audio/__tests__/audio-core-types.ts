export type UsbAudioSpeakerOutputOptions = {
  streamId: number
  sampleRate: number
  channels: number
  bitsPerSample: number
  onWritable(this: UsbAudioSpeakerOutput, size: number): void
  onDrained(this: UsbAudioSpeakerOutput): void
  onError(this: UsbAudioSpeakerOutput): void
}

export type UsbAudioSpeakerOutput = {
  volume: number
  readonly bufferedBytes: number
  readonly physicalWrittenBytes: number
  readonly physicalWritableBytes: number
  readonly physicalWritableCallbacks: number
  readonly physicalMaxWritableGapMilliseconds: number
  readonly physicalAudioActive: boolean
  readonly physicalAwaitingDrain: boolean
  start(): void
  poll(): void
  write(payload: Uint8Array): void
  finish(): void
  stop(): void
  close(): void
}

export type UsbAudioSpeakerOutputFactory = (options: UsbAudioSpeakerOutputOptions) => UsbAudioSpeakerOutput
