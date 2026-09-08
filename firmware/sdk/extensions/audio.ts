import type { AppContext } from 'stackchan/app'
import type { PlaybackOptions } from 'stackchan/audio'
import { StackchanError } from 'stackchan/errors'
import type { Connection } from 'stackchan/extensions/network'
export type RadioState = 'idle' | 'connecting' | 'buffering' | 'playing' | 'stalled' | 'retrying' | 'error'
/** A note name (C4, F+4, ...), duration in beats, and one kana mora; R is a rest with empty lyrics. */
export type SongNote = readonly [note: string, beats: number, lyric: string]
export interface AppSinging {
  /** 20–300 BPM, 1–256 notes. Requires a singing provider; cancellation releases the shared output. */
  sing(bpm: number, score: readonly SongNote[], options?: PlaybackOptions): Promise<void>
}
export function singing(app: AppContext): AppSinging {
  const value = app.audio as AppContext['audio'] & AppSinging
  if (typeof value.sing !== 'function') throw new StackchanError('UNSUPPORTED', 'Singing requires host API 8')
  return value
}
export interface AppStreamingAudio {
  /** Hold the input until close. Samples are normalized RMS levels (0–1). */
  monitor(handler: (level: number) => void): Promise<Connection>
  /** Hold the output until close. Other audio operations report BUSY. */
  radio(options: {
    url: string
    volume?: number
    reconnect?: boolean
    onState?(state: RadioState, reason?: string): void
  }): Promise<Connection>
}
export function streamingAudio(app: AppContext): AppStreamingAudio {
  const value = (app as AppContext & { streamingAudio?: AppStreamingAudio }).streamingAudio
  if (!value) throw new StackchanError('UNSUPPORTED', 'Streaming audio is unavailable')
  return value
}
