declare module 'embedded:io/audio/duplex' {
  type AudioType = 'LPCM'
  type AudioFormat = 'buffer'

  export type AudioStopOptions = {
    flush?: boolean
  }

  export type AudioDuplexInputOptions = {
    channels?: 1 | 2
    target?: unknown
    onReadable?: (
      this: AudioDuplexInput,
      byteLength: number,
      sampleCount?: number,
    ) => void
  }

  export type AudioDuplexOutputOptions = {
    channels?: 1 | 2
    target?: unknown
    volume?: number
    hardwareAttenuationDb?: number
    onWritable?: (
      this: AudioDuplexOutput,
      byteLength: number,
      sampleCount?: number,
    ) => void
  }

  export type AudioDuplexEchoCancellationOptions = {
    filterLength?: number
    nlpLevel?: 'normal' | 'aggressive' | 'very-aggressive'
    /** Defaults to the measured CoreS3/M5StackChan acoustic path delay (1584 samples at 16 kHz). */
    referenceDelaySamples?: number
    diagnostics?: {
      maxSamples?: number
    }
  }

  export type AudioDuplexOptions = {
    sampleRate: number
    bitsPerSample?: 16
    input?: AudioDuplexInputOptions
    output?: AudioDuplexOutputOptions
    echoCancellation?: boolean | AudioDuplexEchoCancellationOptions
  }

  export type AudioDuplexAecStats = Readonly<{
    enabled: boolean
    internalMemory: boolean
    internalFreeBytes: number
    xsCore: number
    realtimeCore: number
    frameSamples: number
    referenceDelaySamples: number
    exactReferenceFrames: number
    processedFrames: number
    processCalls: number
    microphoneOverruns: number
    referenceOverruns: number
    syncResets: number
    lastProcessUs: number
    maximumProcessUs: number
    averageProcessUs: number
    lastCycleUs: number
    maximumCycleUs: number
    averageCycleUs: number
    microphoneRms: number
    referenceRms: number
    outputRms: number
    erleDb: number
    microphonePeak: number
    referencePeak: number
    outputPeak: number
    microphoneQueuedSamples: number
    referenceQueuedSamples: number
    diagnosticSamples: number
    diagnosticCapacitySamples: number
    diagnosticDroppedSamples: number
  }>

  export type AudioDuplexStats = Readonly<{
    capturedFrames: number
    renderedFrames: number
    inputOverruns: number
    outputUnderruns: number
    aec: AudioDuplexAecStats
  }>

  export interface AudioDuplexInput extends Disposable {
    readonly audioType: AudioType
    readonly bitsPerSample: 16
    readonly channels: 1 | 2
    readonly sampleRate: number
    readonly target?: unknown
    get format(): AudioFormat
    set format(value: AudioFormat)

    read(): ArrayBuffer | undefined
    read(byteLength: number): ArrayBuffer
    read(buffer: ByteBuffer): number

    start(): void
    stop(options?: AudioStopOptions): void
    close(): void
  }

  export interface AudioDuplexOutput extends Disposable {
    readonly audioType: AudioType
    readonly bitsPerSample: 16
    readonly channels: 1 | 2
    readonly sampleRate: number
    readonly target?: unknown
    readonly hardwareAttenuationDb: number | undefined

    get format(): AudioFormat
    set format(value: AudioFormat)

    readonly bufferedBytes: number
    volume: number

    write(buffer: ByteBuffer): void
    start(): void
    stop(options?: AudioStopOptions): void
    close(): void
  }

  class AudioDuplex {
    constructor(options: AudioDuplexOptions)

    readonly input: AudioDuplexInput
    readonly output: AudioDuplexOutput
    readonly sampleRate: number
    readonly bitsPerSample: 16
    readonly inputChannels: 1 | 2
    readonly outputChannels: 1 | 2
    readonly closed: boolean
    readonly stats: AudioDuplexStats

    /**
     * Returns interleaved signed 16-bit samples in
     * [raw microphone, post-volume reference, AEC output] order.
     * Reading drains the current diagnostic capture.
     * Pass maxSamples to drain a bounded chunk without allocating the entire
     * capture in the XS heap.
     */
    readAecDiagnostics(maxSamples?: number): ArrayBuffer | undefined
    /** Discards captured diagnostics and resets their dropped-sample counter. */
    clearAecDiagnostics(): void
    close(): void
  }

  interface AudioDuplex extends Disposable {}

  export { AudioDuplex as default }
  export function openAudioDuplex(options: AudioDuplexOptions): AudioDuplex
}
