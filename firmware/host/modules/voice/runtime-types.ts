// Keep host composition types independent of optional platform implementations.
import type {
  AudioRequirements,
  AudioRuntime,
  DuplexLease,
  MediaBudget,
  Microphone,
  Scope,
  Speaker,
} from './contracts.js'

export type LeaseOptions = Scope & {
  requirements: AudioRequirements
  budget: MediaBudget
  microphone: Microphone
  speaker: Speaker
}
export type LeaseFactory = (options: LeaseOptions) => Promise<DuplexLease> | DuplexLease
export type RuntimeOptions = {
  acquireExclusive: () => () => void
  openNativeLease?: LeaseFactory
  volume?: number
}

export type PairedAudioRuntime = AudioRuntime & { microphone: Microphone; speaker: Speaker }
export type CreateAudioRuntime = (options: RuntimeOptions) => PairedAudioRuntime

export interface PcmOutput {
  write(bytes: Uint8Array, onAccepted?: (size: number) => void): void | Promise<void>
  readonly frames: number
  setVolume(gain: number): void
  drain(): Promise<void>
  close(): void
}
export interface PcmOutputModule {
  readonly minimumOutputBytes: number
  openOutput(sampleRate: number, volume: number, limit: number, onPlayed?: (power: number) => void): PcmOutput
}
