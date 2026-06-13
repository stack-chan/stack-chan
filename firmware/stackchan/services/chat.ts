import Modules from 'modules'
import ChatAudioIOStub from 'chat-audioio-stub'
import type ChatAudioIO from 'ChatAudioIO'

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
  apiKey?: string
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
  chatAudioIOCtor?: ChatAudioIOConstructor
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

type ChatAudioIOConstructor = {
  new (chatOptions: Record<string, unknown>): ChatAudioIO
  FAILED: number
  DISCONNECTED: number
  DISCONNECTING: number
  CONNECTING: number
  CONNECTED: number
  SPEAKING: number
  LISTENING: number
  WAITING: number
}

const loadChatAudioIOConstructor = (): ChatAudioIOConstructor => {
  try {
    const module = Modules.importNow('ChatAudioIO') as { default?: ChatAudioIOConstructor } | ChatAudioIOConstructor
    return ('default' in module && module.default ? module.default : module) as ChatAudioIOConstructor
  } catch (err) {
    trace(`[chat-service] failed to import ChatAudioIO; using stub: ${String(err)}\n`)
    return ChatAudioIOStub as unknown as ChatAudioIOConstructor
  }
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

function mapState(state: number, ChatAudioIOAny: ChatAudioIOConstructor): ChatState {
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
    const ChatAudioIOCtor = options.chatAudioIOCtor ?? loadChatAudioIOConstructor()
    this.#chat = new ChatAudioIOCtor({
      specifier: config.type as unknown as string,
      instructions: config.instructions,
      voiceID: config.voiceID,
      providerID: config.providerID,
      modelID: config.modelID,
      apiKey: config.apiKey,
      functions: functions.length > 0 ? functions : undefined,
      onStateChanged: (state: number) => {
        this.#state = mapState(state, ChatAudioIOCtor)
        this.#error = this.#chat.error ?? ''
        this.#callbacks.onStateChanged(this.#state, this.#error || undefined)
      },
      onInputLevelChanged: (level: number) => this.#callbacks.onInputLevelChanged(level),
      onOutputLevelChanged: (level: number) => this.#callbacks.onOutputLevelChanged(level),
      onInputTranscript: (text: string, more: boolean) => this.#callbacks.onInputTranscript(text, more),
      onOutputTranscript: (text: string, more: boolean) => this.#callbacks.onOutputTranscript(text, more),
      onFunctionCall: (call: string, name: string, params: Record<string, unknown>) =>
        this.#callbacks.onFunctionCall(call, name, params),
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
