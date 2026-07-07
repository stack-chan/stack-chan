import type { TTSCompletion, TTSDoneListener, TTSPlaybackListener } from 'tts-types'

export type TTS = {
  stream: (text: string, volume?: number, callback?: TTSCompletion) => void
  onPlayed?: TTSPlaybackListener
  onDone?: TTSDoneListener
}
