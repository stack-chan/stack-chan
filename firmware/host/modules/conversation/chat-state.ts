export const ChatState = Object.freeze({
  FAILED: 0,
  DISCONNECTED: 1,
  DISCONNECTING: 2,
  CONNECTING: 3,
  CONNECTED: 4,
  SPEAKING: 5,
  LISTENING: 6,
  WAITING: 7,
} as const)

export type ChatState = (typeof ChatState)[keyof typeof ChatState]

const chatStateNames = Object.freeze([
  'FAILED',
  'DISCONNECTED',
  'DISCONNECTING',
  'CONNECTING',
  'CONNECTED',
  'SPEAKING',
  'LISTENING',
  'WAITING',
] as const)
export type ChatStateName = (typeof chatStateNames)[number]
export const ChatStateNames: readonly ChatStateName[] = chatStateNames

export function chatStateToName(state: ChatState): ChatStateName {
  return chatStateNames[state] ?? 'DISCONNECTED'
}

export type ChatTranscriptRole = 'input' | 'output'

export const MAX_TRANSCRIPT_CHARS = 4096

export type ChatTranscriptSnapshot = {
  input: string
  output: string
}

export type ChatFunctionCallStatus = 'requested' | 'completed'

export type ChatFunctionCallSnapshot = {
  call: string
  name: string
  params: Record<string, unknown>
  status: ChatFunctionCallStatus
  result?: unknown
}

const MAX_FUNCTION_CALLS = 16

function cloneRecord(record: Record<string, unknown>): Record<string, unknown> {
  return { ...record }
}

function trimTranscript(text: string): string {
  return text.length > MAX_TRANSCRIPT_CHARS ? text.slice(text.length - MAX_TRANSCRIPT_CHARS) : text
}

export class ChatSessionState {
  #state: ChatState = ChatState.DISCONNECTED
  #error = ''
  #inputTranscript = ''
  #outputTranscript = ''
  #functionCalls: ChatFunctionCallSnapshot[] = []

  get state(): ChatState {
    return this.#state
  }

  get error(): string {
    return this.#error
  }

  get transcript(): ChatTranscriptSnapshot {
    return {
      input: this.#inputTranscript,
      output: this.#outputTranscript,
    }
  }

  get functionCalls(): ChatFunctionCallSnapshot[] {
    return this.#functionCalls.map((call) => ({
      call: call.call,
      name: call.name,
      params: cloneRecord(call.params),
      status: call.status,
      result: call.result,
    }))
  }

  setState(state: ChatState, error = ''): void {
    this.#state = state
    this.#error = error
  }

  appendTranscript(role: ChatTranscriptRole, text: string, more: boolean): void {
    const chunk = text ?? ''
    if (more && chunk.length === 0) {
      this.#setTranscript(role, '')
      return
    }
    const previous = role === 'input' ? this.#inputTranscript : this.#outputTranscript
    this.#setTranscript(role, previous + chunk)
  }

  clearTranscript(role?: ChatTranscriptRole): void {
    if (role == null || role === 'input') this.#inputTranscript = ''
    if (role == null || role === 'output') this.#outputTranscript = ''
  }

  recordFunctionCall(call: string, name: string, params: Record<string, unknown>): void {
    this.#functionCalls.push({
      call,
      name,
      params: cloneRecord(params ?? {}),
      status: 'requested',
    })
    this.#trimFunctionCalls()
  }

  recordFunctionResult(call: string, name: string, result: unknown): void {
    for (let i = this.#functionCalls.length - 1; i >= 0; i -= 1) {
      const entry = this.#functionCalls[i]
      if (entry?.call === call && entry.name === name) {
        entry.status = 'completed'
        entry.result = result
        return
      }
    }
    this.#functionCalls.push({
      call,
      name,
      params: {},
      status: 'completed',
      result,
    })
    this.#trimFunctionCalls()
  }

  clearFunctionCalls(): void {
    this.#functionCalls.splice(0)
  }

  #setTranscript(role: ChatTranscriptRole, text: string): void {
    const next = trimTranscript(text)
    if (role === 'input') {
      this.#inputTranscript = next
      return
    }
    this.#outputTranscript = next
  }

  #trimFunctionCalls(): void {
    while (this.#functionCalls.length > MAX_FUNCTION_CALLS) {
      this.#functionCalls.shift()
    }
  }
}
