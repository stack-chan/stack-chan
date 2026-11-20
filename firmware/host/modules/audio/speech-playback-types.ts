export type SpeechCompletion = (error?: unknown) => void
export type SpeechPlaybackListener = (power: number) => void
export type SpeechDoneListener = () => void

export type SpeechPlayback = {
  stream(text: string, volume?: number, callback?: SpeechCompletion): void
  streamKoe?(koe: string, volume?: number, callback?: SpeechCompletion): void
  onPlayed?: SpeechPlaybackListener
  onDone?: SpeechDoneListener
}
