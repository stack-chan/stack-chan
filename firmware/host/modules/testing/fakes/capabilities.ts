export type { SpeechPlayback } from 'speech-playback-types'

export type * from '../../audio/media-types.js'

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
