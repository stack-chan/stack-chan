import ChatAudioIO from 'ChatAudioIO'
import StackchanChatAudioIO from 'stackchanChatAudioIO'
import {
  type ChatFunctionCallSnapshot,
  ChatSessionState,
  ChatState,
  type ChatState as ChatStateValue,
  type ChatTranscriptSnapshot,
} from 'chat-state'

export { ChatState, type ChatStateName, ChatStateNames, chatStateToName, MAX_TRANSCRIPT_CHARS } from 'chat-state'

export type ChatType =
  | 'deepgramAgent'
  | 'elevenLabsAgent'
  | 'googleGeminiLive'
  | 'humeAIEVI'
  | 'openAIRealtime'
  | 'xiaozhi'

export type ChatConfig = {
  type: ChatType
  specifier?: string
  endpoint?: string
  apiKey?: string
  instructions?: string
  voiceID?: string
  providerID?: string
  modelID?: string
}

export type ChatToolSchema = {
  name: string
  description?: string
  parameters?: {
    type: 'object'
    properties: Record<string, { type: string; description?: string }>
    required?: string[]
    additionalProperties?: boolean
  }
  // Dialogue互換 (inputSchema) を許容
  inputSchema?: {
    type: 'object'
    properties: Record<string, { type: string; description?: string }>
    required?: string[]
    additionalProperties?: boolean
  }
}

export type ChatTool = ChatToolSchema & {
  execute?: (params: Record<string, unknown>) => Promise<unknown> | unknown
}

export type ChatCallbacks = {
  onStateChanged?: (state: ChatStateValue, error?: string) => void
  onInputLevelChanged?: (level: number) => void
  onOutputLevelChanged?: (level: number) => void
  onInputTranscript?: (text: string, more: boolean) => void
  onOutputTranscript?: (text: string, more: boolean) => void
  onFunctionCall?: (call: string, name: string, params: Record<string, unknown>) => void
}

type ChatServiceOptions = {
  config: ChatConfig
  tools?: Record<string, ChatTool>
  callbacks?: ChatCallbacks
  chatAudioIOCtor?: new (chatOptions: Record<string, unknown>) => ChatAudioIO
  sessionState?: ChatSessionState
}

type ChatFunctionSchema = {
  name: string
  description?: string
  parameters: {
    type: 'object'
    properties: Record<string, { type: string; description?: string }>
    required?: string[]
    additionalProperties?: boolean
  }
}

const noop = () => {}

type ChatAudioIOStateConstants = {
  FAILED: number
  DISCONNECTED: number
  DISCONNECTING: number
  CONNECTING: number
  CONNECTED: number
  SPEAKING: number
  LISTENING: number
  WAITING: number
}

function toFunctionSchema(tool: ChatTool): ChatFunctionSchema | null {
  if (!tool?.name) return null
  const parameters = tool.parameters ?? tool.inputSchema
  if (!parameters) {
    return {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    }
  }
  return {
    name: tool.name,
    description: tool.description,
    parameters,
  }
}

function mapState(state: number, constants: ChatAudioIOStateConstants): ChatStateValue {
  switch (state) {
    case constants.FAILED:
      return ChatState.FAILED
    case constants.DISCONNECTED:
      return ChatState.DISCONNECTED
    case constants.DISCONNECTING:
      return ChatState.DISCONNECTING
    case constants.CONNECTING:
      return ChatState.CONNECTING
    case constants.CONNECTED:
      return ChatState.CONNECTED
    case constants.SPEAKING:
      return ChatState.SPEAKING
    case constants.LISTENING:
      return ChatState.LISTENING
    case constants.WAITING:
      return ChatState.WAITING
    default:
      return ChatState.DISCONNECTED
  }
}

export class ChatService {
  #chat: ChatAudioIO
  #state: ChatStateValue = ChatState.DISCONNECTED
  #error = ''
  #callbacks: Required<ChatCallbacks>
  #sessionState: ChatSessionState

  constructor(options: ChatServiceOptions) {
    this.#sessionState = options.sessionState ?? new ChatSessionState()
    const callbacks = options.callbacks ?? {}
    this.#callbacks = {
      onStateChanged: callbacks.onStateChanged ?? noop,
      onInputLevelChanged: callbacks.onInputLevelChanged ?? noop,
      onOutputLevelChanged: callbacks.onOutputLevelChanged ?? noop,
      onInputTranscript: callbacks.onInputTranscript ?? noop,
      onOutputTranscript: callbacks.onOutputTranscript ?? noop,
      onFunctionCall: callbacks.onFunctionCall ?? noop,
    }

    const functions = Object.values(options.tools ?? {})
      .map((tool) => toFunctionSchema(tool))
      .filter((schema): schema is ChatFunctionSchema => schema != null)

    const { config } = options
    const ChatAudioIOCtor =
      options.chatAudioIOCtor ??
      ((config.type === 'xiaozhi' ? StackchanChatAudioIO : ChatAudioIO) as unknown as {
        new (chatOptions: Record<string, unknown>): ChatAudioIO
      })
    const chatAudioIOConstants = ChatAudioIOCtor as unknown as ChatAudioIOStateConstants
    this.#chat = new ChatAudioIOCtor({
      specifier: config.specifier ?? (config.type as unknown as string),
      instructions: config.instructions,
      voiceID: config.voiceID,
      // ChatAudioIO has no endpoint slot. Only an explicit server endpoint is
      // routed through providerID; ordinary workers keep their provider ID.
      providerID: config.endpoint ?? config.providerID,
      modelID: config.modelID,
      apiKey: config.apiKey,
      functions: functions.length > 0 ? functions : undefined,
      onStateChanged: (state: number) => {
        this.#state = mapState(state, chatAudioIOConstants)
        this.#error = this.#chat.error ?? ''
        this.#sessionState.setState(this.#state, this.#error)
        this.#callbacks.onStateChanged(this.#state, this.#error || undefined)
      },
      onInputLevelChanged: (level: number) => this.#callbacks.onInputLevelChanged(level),
      onOutputLevelChanged: (level: number) => this.#callbacks.onOutputLevelChanged(level),
      onInputTranscript: (text: string, more: boolean) => {
        this.#sessionState.appendTranscript('input', text, more)
        this.#callbacks.onInputTranscript(text, more)
      },
      onOutputTranscript: (text: string, more: boolean) => {
        this.#sessionState.appendTranscript('output', text, more)
        this.#callbacks.onOutputTranscript(text, more)
      },
      onFunctionCall: (call: string, name: string, params: Record<string, unknown>) => {
        this.#sessionState.recordFunctionCall(call, name, params)
        this.#callbacks.onFunctionCall(call, name, params)
      },
    })
  }

  get state(): ChatStateValue {
    return this.#state
  }

  get error(): string {
    return this.#error
  }

  get transcript(): ChatTranscriptSnapshot {
    return this.#sessionState.transcript
  }

  get functionCalls(): ChatFunctionCallSnapshot[] {
    return this.#sessionState.functionCalls
  }

  start(): void {
    this.#sessionState.clearTranscript()
    this.#chat.connect()
  }

  stop(): void {
    this.#chat.disconnect()
  }

  close(): void {
    this.#chat.close()
  }

  sendText(text: string): void {
    this.#chat.sendText(text)
  }

  sendFunctionResult(call: string, name: string, result: unknown): void {
    this.#sessionState.recordFunctionResult(call, name, result)
    this.#chat.sendFunctionResult(call, name, result)
  }

  setMicrophoneEnabled(enabled: boolean): void {
    this.#chat.changeMicrophone(enabled)
  }

  setVolume(volume: number): void {
    this.#chat.changeVolume(volume)
  }
}
