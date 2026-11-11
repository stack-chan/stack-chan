declare module 'realtimeConversation' {
  import type { Conversation, Delegation } from 'stackchan/voice/contracts'
  export type Transcript = { role: 'user' | 'assistant'; delta: string; start_ms: number; end_ms: number }
  export type LiveSessionSettings = {
    model: string
    instructions: string
    audio: { output: { voice: string } }
    delegation?: object
    store: false
  }
  export type Signaling = {
    createSession(input: {
      sdp: string
      session: LiveSessionSettings
      canStart(): boolean
      starting(): void
    }): Promise<{ status: number; text(): Promise<string> } | undefined>
    acceptSession?(result: { session: { id: string }; [key: string]: unknown }): void
    hangup(input: { sessionId: string }): Promise<void>
  }
  export type LiveOptions = ({ apiKey: string; signaling?: never } | { signaling: Signaling; apiKey?: never }) & {
    model?: string
    voice?: string
    instructions?: string
    delegation?: Delegation
    toolTimeout?: number
    onToolResult?(result: {
      callId: string
      responseId: string
      delegationId: string
      name: string
      output?: string
      error?: string
    }): void
    onStateChanged?(state: 'idle' | 'connecting' | 'connected' | 'closing' | 'closed' | 'error'): void
    onTranscript?(fragment: Transcript): void
    onEvent?(event: { type: string; [key: string]: unknown }): void
    onError?(error: Error & { code: string; stage: string; status?: number }): void
  }
  export function createLiveConversation(options: LiveOptions): Conversation
}
