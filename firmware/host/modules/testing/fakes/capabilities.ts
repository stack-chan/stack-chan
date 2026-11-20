import type { TTSCompletion, TTSDoneListener, TTSPlaybackListener } from 'tts-types'

export type TTS = {
  stream: (text: string, volume?: number, callback?: TTSCompletion) => void
  streamKoe?: (koe: string, volume?: number, callback?: TTSCompletion) => void
  onPlayed?: TTSPlaybackListener
  onDone?: TTSDoneListener
}

export type MediaState = WebRadioState | 'ended' | 'paused'

export type MediaProgress = { position: number; duration?: number; estimated: boolean; seekable: boolean }

export type MediaStartOptions = {
  url: string
  mode: 'live' | 'finite'
  volume?: number
  /** Optional RSS duration hint in seconds. */
  duration?: number
  onProgress?: (progress: MediaProgress) => void
  /** Applies only to live playback. Finite playback never restarts automatically. */
  reconnect?: boolean
  onStateChanged?: (state: MediaState, reason?: string) => void
}

export type MediaCapability = {
  readonly state: MediaState
  start(options: MediaStartOptions): Promise<void>
  readonly progress: MediaProgress
  pause(): void
  resume(): Promise<void>
  seek(seconds: number): Promise<void>
  stop(): void
  setVolume(volume: number): void
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

export type RemoteConversationState = 'standby' | 'connecting' | 'listening' | 'recognizing' | 'speaking' | 'blocked'
export type RemoteConversationTransportState = 'disconnected' | 'unsupported' | 'ready'
export type RemoteConversationActivationState = 'inactive' | 'active'
export type RemoteConversationListener = (state: RemoteConversationState, error?: string) => void
export type RemoteConversationTransportListener = (state: RemoteConversationTransportState) => void

export type RemoteConversationSessionDelegate = {
  readonly state: RemoteConversationState
  readonly lastError?: string
  readonly transportState: RemoteConversationTransportState
  requestStart(): string
  requestStop(): string
  subscribe(listener: RemoteConversationListener): () => void
  subscribeTransport(listener: RemoteConversationTransportListener): () => void
}

export type RemoteConversationSession = RemoteConversationSessionDelegate & {
  readonly activationState: RemoteConversationActivationState
  activate(): void
  deactivate(): void
}

export type StackchanContext = unknown

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
