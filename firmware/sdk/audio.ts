import type { OperationOptions } from 'stackchan/task'

/** Application-owned bytes. Keep them unchanged until a playback operation settles. */
export type AudioData = Readonly<{ data: ArrayBuffer; mimeType: string }>
export type RecordedAudio = AudioData & Readonly<{ filename: string }>
export type PlaybackOptions = OperationOptions & { volume?: number }
export type RecordingOptions = OperationOptions & { durationMs?: number }

export interface AppAudio {
  /** Speak natural language. Resource names belong to playClip. */
  say(text: string, options?: PlaybackOptions): Promise<void>
  playClip(name: string, options?: PlaybackOptions): Promise<void>
  /** 10–20,000 Hz, 0–60,000 ms. Completion includes releasing the output. */
  tone(hz: number, options: PlaybackOptions & { durationMs: number }): Promise<void>
  /** Record for 1–15,000 ms (default 3,000), then release the input before returning its actual format. */
  record(options?: RecordingOptions): Promise<RecordedAudio>
  /** Play encoded audio and release the output. Decoding and playback failures reject. */
  play(audio: AudioData, options?: PlaybackOptions): Promise<void>
}
