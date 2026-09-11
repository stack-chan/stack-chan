export type TTSCompletion = (error?: unknown) => void
export type TTSPlaybackListener = (power: number) => void
export type TTSDoneListener = () => void

export type TTS = {
  /** Reports current backend availability without acquiring the output. */
  available?: () => boolean
  stream: (text: string, volume?: number, callback?: TTSCompletion) => void
  /** Streams raw stackchan-voice koe notation when the provider supports singing. */
  streamKoe?: (koe: string, volume?: number, callback?: TTSCompletion) => void
  onPlayed?: TTSPlaybackListener
  onDone?: TTSDoneListener
  /** Cancels the current playback, releases its resources, and completes with an error. */
  cancelPlayback?: (reason?: unknown) => void | Promise<void>
  close?: () => void | Promise<void>
}
