import ChatAudioIO from 'ChatAudioIO'

export type ChatState =
  | 'FAILED'
  | 'DISCONNECTED'
  | 'DISCONNECTING'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'SPEAKING'
  | 'LISTENING'
  | 'WAITING'

export type ChatType = 'deepgramAgent' | 'elevenLabsAgent' | 'googleGeminiLive' | 'humeAIEVI' | 'openAIRealtime'

export type ChatConfig = {
  type: ChatType
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
  onStateChanged?: (state: ChatState, error?: string) => void
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

const ChatAudioIOAny = ChatAudioIO as unknown as {
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

function mapState(state: number): ChatState {
  switch (state) {
    case ChatAudioIOAny.FAILED:
      return 'FAILED'
    case ChatAudioIOAny.DISCONNECTED:
      return 'DISCONNECTED'
    case ChatAudioIOAny.DISCONNECTING:
      return 'DISCONNECTING'
    case ChatAudioIOAny.CONNECTING:
      return 'CONNECTING'
    case ChatAudioIOAny.CONNECTED:
      return 'CONNECTED'
    case ChatAudioIOAny.SPEAKING:
      return 'SPEAKING'
    case ChatAudioIOAny.LISTENING:
      return 'LISTENING'
    case ChatAudioIOAny.WAITING:
      return 'WAITING'
    default:
      return 'DISCONNECTED'
  }
}

export class ChatService {
  #chat: ChatAudioIO
  #state: ChatState = 'DISCONNECTED'
  #error = ''
  #callbacks: Required<ChatCallbacks>

  constructor(options: ChatServiceOptions) {
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
      (ChatAudioIO as unknown as {
        new (chatOptions: Record<string, unknown>): ChatAudioIO
      })
    this.#chat = new ChatAudioIOCtor({
      specifier: config.type as unknown as string,
      instructions: config.instructions,
      voiceID: config.voiceID,
      providerID: config.providerID,
      modelID: config.modelID,
      functions: functions.length > 0 ? functions : undefined,
      onStateChanged: (state) => {
        this.#state = mapState(state)
        this.#error = this.#chat.error ?? ''
        this.#callbacks.onStateChanged(this.#state, this.#error || undefined)
      },
      onInputLevelChanged: (level) => this.#callbacks.onInputLevelChanged(level),
      onOutputLevelChanged: (level) => this.#callbacks.onOutputLevelChanged(level),
      onInputTranscript: (text, more) => this.#callbacks.onInputTranscript(text, more),
      onOutputTranscript: (text, more) => this.#callbacks.onOutputTranscript(text, more),
      onFunctionCall: (call, name, params) => this.#callbacks.onFunctionCall(call, name, params),
    })
  }

  get state(): ChatState {
    return this.#state
  }

  get error(): string {
    return this.#error
  }

  start(): void {
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
    this.#chat.sendFunctionResult(call, name, result)
  }

  setMicrophoneEnabled(enabled: boolean): void {
    this.#chat.changeMicrophone(enabled)
  }

  setVolume(volume: number): void {
    this.#chat.changeVolume(volume)
  }
}
