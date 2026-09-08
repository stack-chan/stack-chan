import type { AppContext } from 'stackchan/app'
import { StackchanError } from 'stackchan/errors'
import type { Connection } from 'stackchan/extensions/network'
export type RadioState = 'idle' | 'connecting' | 'buffering' | 'playing' | 'stalled' | 'retrying' | 'error'
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
