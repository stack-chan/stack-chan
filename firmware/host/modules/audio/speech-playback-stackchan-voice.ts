import type { SpeechCompletion, SpeechDoneListener, SpeechPlaybackListener } from 'speech-playback-types'

export class SpeechPlayback {
  onPlayed?: SpeechPlaybackListener
  onDone?: SpeechDoneListener
  streaming = false

  // biome-ignore lint/complexity/noUselessConstructor: keep the constructor compatible with the target-specific implementation.
  constructor(_options?: unknown) {}

  stream(_text: string, _volume?: number, callback?: SpeechCompletion): void {
    callback?.(new Error('stackchan-voice is unavailable on this target'))
  }

  streamKoe(_koe: string, _volume?: number, callback?: SpeechCompletion): void {
    callback?.(new Error('stackchan-voice singing is unavailable on this target'))
  }
}
