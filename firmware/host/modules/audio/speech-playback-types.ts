import type { Speaker } from '../voice/contracts.js'

export type SpeechCompletion = (error?: unknown) => void
export type SpeechPlaybackListener = (power: number) => void
export type SpeechDoneListener = () => void

export type SpeechPlayback = {
  stream(text: string, volume?: number, callback?: SpeechCompletion): void
  streamKoe?(koe: string, volume?: number, callback?: SpeechCompletion): void
  onPlayed?: SpeechPlaybackListener
  onDone?: SpeechDoneListener
}

export type UtterancePlayback = {
  done: Promise<void>
  cancel(): void
}

export interface SpeakerSpeechPlayback {
  playUtterance(
    speaker: Speaker,
    kind: 'text' | 'koe',
    text: string,
    volume: number | undefined,
    onPlayed: SpeechPlaybackListener,
  ): UtterancePlayback
}
