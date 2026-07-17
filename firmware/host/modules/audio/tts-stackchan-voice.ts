import type { TTSCompletion, TTSDoneListener, TTSPlaybackListener } from 'tts-types'

export class TTS {
  onPlayed?: TTSPlaybackListener
  onDone?: TTSDoneListener
  streaming = false

  // biome-ignore lint/complexity/noUselessConstructor: keep the constructor compatible with the target-specific implementation.
  constructor(_options?: unknown) {}

  stream(_text: string, _volume?: number, callback?: TTSCompletion): void {
    callback?.(new Error('stackchan-voice is unavailable on this target'))
  }

  streamKoe(_koe: string, _volume?: number, callback?: TTSCompletion): void {
    callback?.(new Error('stackchan-voice singing is unavailable on this target'))
  }
}
