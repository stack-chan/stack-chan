import type { TTSCompletion, TTSDoneListener, TTSPlaybackListener } from 'tts-types'

export type TTS = {
  stream: (text: string, volume?: number, callback?: TTSCompletion) => void
  onPlayed?: TTSPlaybackListener
  onDone?: TTSDoneListener
}

export type RobotLed = {
  on(r: number, g: number, b: number, duration?: number, index?: number, count?: number): void
  off(index?: number, count?: number): void
  blink(r: number, g: number, b: number, duration: number, index?: number, count?: number): void
  rainbow(index?: number, count?: number): void
}

export type RobotUI = Record<string, unknown>
