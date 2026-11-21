import type {
  CloseOptions,
  CloseResult,
  Conversation,
  ConversationEvent,
  DuplexLease,
  PlaybackReceipt,
  Scope,
} from 'stackchan/voice/contracts'

export type MuseVoiceBridgeEvent =
  | Exclude<ConversationEvent, { type: 'turn.ended' }>
  | { type: 'turn.settled'; turnId: string }

export interface MuseVoiceBridge {
  /** Rejection must release all resources acquired during connection. */
  open(
    options: Scope & {
      media: Pick<DuplexLease, 'input' | 'output' | 'media'>
      onEvent(event: MuseVoiceBridgeEvent): void
    },
  ): Promise<{
    id: string
    setInputEnabled(enabled: boolean): Promise<void>
    /** Fence local playback only; this is not a remote generation cancellation. */
    interrupt(): Promise<readonly PlaybackReceipt[]>
    /** Resolve only after native callbacks and audio links are detached. Confirm only an acknowledged end-call. */
    close(options: CloseOptions): Promise<CloseResult>
  }>
}
/** Provider turn settlement is not playback finality; output.playback carries device receipts separately. */
export function createMuseConversation(bridge: MuseVoiceBridge): Conversation
