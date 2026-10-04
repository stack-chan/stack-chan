// Copyright (c) 2026 Shinya Ishikawa
// SPDX-License-Identifier: Apache-2.0

declare module 'realtimeConversation' {
  export type ConversationState = 'idle' | 'connecting' | 'connected' | 'closing' | 'closed' | 'error'
  export interface Usage {
    seconds: number
    [key: string]: unknown
  }
  export interface CloseResult {
    finalized: boolean
    reason: string
    usage?: Usage
  }
  export interface Transcript {
    role: 'user' | 'assistant'
    delta: string
    start_ms: number
    end_ms: number
  }
  export interface ConversationError extends Error {
    code: string
    stage: string
    status?: number
  }
  export interface ToolContext {
    callId: string
    responseId: string
    delegationId: string
    isCancelled(): boolean
  }
  export interface ConversationTool {
    name: string
    description?: string
    parameters: { type: 'object'; [key: string]: unknown }
    strict?: boolean
    execute(args: Record<string, unknown>, context: ToolContext): unknown | Promise<unknown>
  }
  export interface ToolResult {
    name: string
    callId: string
    responseId: string
    delegationId: string
    output?: string
    error?: string
  }
  export interface ConversationOptions {
    apiKey?: string
    broker?: { url: string; deviceToken: string; certificate?: ArrayBuffer }
    signaling?: {
      createSession(input: {
        sdp: string
        canStart(): boolean
        starting(): void
      }): Promise<{ status: number; text(): Promise<string> } | undefined>
      acceptSession?(result: { session: { id: string }; [key: string]: unknown }): void
      hangup(input: { sessionId: string }): Promise<void>
    }
    model?: string
    voice?: string
    instructions?: string
    delegation?: Record<string, unknown>
    tools?: ConversationTool[]
    toolTimeout?: number
    onToolResult?(result: ToolResult): void
    onStateChanged?(state: ConversationState): void
    onTranscript?(fragment: Transcript): void
    onEvent?(event: { type: string; [key: string]: unknown }): void
    onError?(error: ConversationError): void
  }
  export interface ConversationStats {
    capturedSamples: number
    renderedSamples: number
    underruns: number
    overruns: number
    micLevel: number
    cleanLevel: number
    referenceLevel: number
    outputIdleMs: number
    silenceMs: number
    maxSilenceMs: number
    freeHeap: number
    freeInternalHeap: number
  }
  export default class RealtimeConversation {
    constructor(options: ConversationOptions)
    readonly state: ConversationState
    readonly sessionId: string | undefined
    readonly muted: boolean
    readonly volume: number
    readonly usage: Usage | undefined
    readonly stats: ConversationStats | undefined
    connect(): Promise<{ id: string }>
    close(): Promise<CloseResult>
    setMuted(value: boolean): Promise<void>
    setVolume(value: number): void
    setTools(tools: ConversationTool[]): void
  }
}
