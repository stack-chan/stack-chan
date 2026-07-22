export type PhysicalAudioOutOptions = {
  sampleRate?: number
  bitsPerSample?: 8 | 16
  channels?: 1 | 2
  numChannels?: 1 | 2
  onWritable?: (size: number) => void
}

export default class PhysicalAudioOut {
  constructor(options?: PhysicalAudioOutOptions)
  readonly sampleRate: number
  readonly bitsPerSample: number
  readonly channels: number
  readonly audioType: 'LPCM'
  format: 'buffer'
  volume: number
  write(samples: ArrayBuffer | ArrayBufferView): void
  start(): void
  stop(options?: { flush?: boolean }): void
  close(): void
}
