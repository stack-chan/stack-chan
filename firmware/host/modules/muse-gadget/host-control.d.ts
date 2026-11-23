import type { ConversationEvent, Microphone, Speaker } from 'stackchan/voice/contracts'

export type MuseConversationPhase =
  | 'idle'
  | 'unpaired'
  | 'pairing'
  | 'confirm'
  | 'review'
  | 'connecting'
  | 'ready'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'ending'
  | 'failed'

export interface MuseConversationState {
  readonly phase: MuseConversationPhase
  readonly name?: string
  readonly error?: string
  readonly sdkReady?: boolean
}

export interface MuseConversationControl {
  snapshot(): MuseConversationState
  start(): Promise<boolean>
  setTalking(pressed: boolean): Promise<boolean>
  end(): Promise<void>
  close(): Promise<void>
  startPairing(): Promise<boolean>
  confirmPairing(): Promise<boolean>
  savePairing(): Promise<boolean>
  cancelPairing(): Promise<void>
}

export function createMuseConversationControl(options: {
  microphone: Microphone
  speaker: Speaker
  volume: number
  onEvent?: (event: ConversationEvent) => void
  onState?: (state: MuseConversationState) => void
}): MuseConversationControl
