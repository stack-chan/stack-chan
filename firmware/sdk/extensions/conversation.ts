import type { AppContext } from 'stackchan/app'
import type { RecordedAudio } from 'stackchan/audio'
import { StackchanError } from 'stackchan/errors'
import type { Connection, Tool } from 'stackchan/extensions/network'
import type { OperationOptions, Unsubscribe } from 'stackchan/task'

export type RealtimeProvider = 'deepgramAgent' | 'elevenLabsAgent' | 'googleGeminiLive' | 'humeAIEVI' | 'openAIRealtime'
export type ChatState =
  | 'disconnected'
  | 'disconnecting'
  | 'connecting'
  | 'connected'
  | 'speaking'
  | 'listening'
  | 'waiting'
  | 'failed'
export type RealtimeOptions = {
  provider?: RealtimeProvider
  apiKey?: string
  endpoint?: string
  model?: string
  voice?: string
  instructions?: string
  volume?: number
  tools?: readonly Tool[]
  onState?(state: ChatState, error?: string): void
  onTranscript?(text: string, more: boolean): void
  /** Normalized output level (0–1). */
  onOutputLevel?(level: number): void
}
export interface Dialogue extends Connection {
  ask(text: string, options?: OperationOptions): Promise<string>
  clear(): void
  /** Snapshot of the last three completed user/assistant turns; excludes seed messages. */
  readonly history: readonly DialogueMessage[]
}
export type DialogueMessage = Readonly<{ role: 'user' | 'assistant'; content: string }>
export type DialogueOptions = {
  instructions?: string
  /** Initial examples, retained by clear(). Use instructions for the system prompt. */
  messages?: readonly DialogueMessage[]
} & (
  | { provider?: 'openai'; apiKey?: string; model?: string; tools?: readonly Tool[] }
  | { provider: 'claude' | 'gemini'; apiKey: string; model: string; tools?: never }
)
export type MCPOptions = Readonly<{ url: string; token?: string }>
export interface ToolConnection extends Connection {
  /** Pass these tools to dialogue() or realtime(); closing the connection cancels calls. */
  readonly tools: readonly Tool[]
}
export type RemoteState = 'standby' | 'connecting' | 'listening' | 'recognizing' | 'speaking' | 'blocked'
export type RemoteTransport = 'disconnected' | 'unsupported' | 'ready'
export interface RemoteConversation extends Connection {
  readonly state: RemoteState
  readonly transport: RemoteTransport
  readonly lastError?: string
  /** Return an accepted request ID. Observe state changes for completion. */
  requestStart(): string
  requestStop(): string
  onState(handler: (state: RemoteState, error?: string) => void): Unsubscribe
  onTransport(handler: (state: RemoteTransport) => void): Unsubscribe
}
export interface AppConversation {
  dialogue(options?: DialogueOptions): Dialogue
  connectTools(options: MCPOptions, operation?: OperationOptions): Promise<ToolConnection>
  transcribe(audio: RecordedAudio, options?: OperationOptions & { apiKey?: string; language?: string }): Promise<string>
  realtime(options: RealtimeOptions): Promise<Connection>
  /** Activate the USB conversation and its approval UI. Closing deactivates both. */
  remote(): RemoteConversation
}
export function conversation(app: AppContext): AppConversation {
  const value = (app as AppContext & { conversation?: AppConversation }).conversation
  if (!value) throw new StackchanError('UNSUPPORTED', 'Conversation services are unavailable')
  return value
}
