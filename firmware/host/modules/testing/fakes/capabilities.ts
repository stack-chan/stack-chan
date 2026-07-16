import type { TTSCompletion, TTSDoneListener, TTSPlaybackListener } from 'tts-types'

export type TTS = {
  stream: (text: string, volume?: number, callback?: TTSCompletion) => void
  onPlayed?: TTSPlaybackListener
  onDone?: TTSDoneListener
}

export type WebRadioState = 'idle' | 'connecting' | 'buffering' | 'playing' | 'stalled' | 'retrying' | 'error'

export type WebRadioStartOptions = {
  url: string
  volume?: number
  sampleRate?: number
  reconnect?: boolean
  onStateChanged?: (state: WebRadioState, reason?: string) => void
}

export type WebRadioCapability = {
  readonly state: WebRadioState
  start(options: WebRadioStartOptions): Promise<void>
  stop(): void
  setVolume(volume: number): void
}

export type RobotLed = {
  on(r: number, g: number, b: number, duration?: number, index?: number, count?: number): void
  off(index?: number, count?: number): void
  blink(r: number, g: number, b: number, duration: number, index?: number, count?: number): void
  rainbow(index?: number, count?: number): void
}

export type NetworkReadyResult =
  | {
      status: 'connected'
    }
  | {
      status: 'skipped'
      reason: string
    }
  | {
      status: 'failed'
      reason: string
    }
