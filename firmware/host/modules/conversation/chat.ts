import ChatAudioIO from 'StackChanChatAudioIO'
import {
  type ChatFunctionCallSnapshot,
  ChatSessionState,
  ChatState,
  type ChatState as ChatStateValue,
  type ChatTranscriptSnapshot,
} from 'chat-state'
import config from 'mc/config'

export { ChatState, type ChatStateName, ChatStateNames, chatStateToName, MAX_TRANSCRIPT_CHARS } from 'chat-state'

export type ChatType = 'deepgramAgent' | 'elevenLabsAgent' | 'googleGeminiLive' | 'humeAIEVI' | 'openAIRealtime'

/** Legacy ChatAudioIO configuration. Prefer a connection factory for server-backed transports. */
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

export type ChatListeningMode = 'auto' | 'manual' | 'realtime'

export type XiaozhiV1McpOptions = {
  serverInfo?: {
    name?: string
    version?: string
  }
}

export type XiaozhiV1ConnectionOptions = {
  endpoint: string
  accessToken?: string
  deviceId: string
  clientId: string
  instructions?: string
  voiceID?: string
  helloExtension?: Record<string, unknown>
  listeningMode?: ChatListeningMode
  features?: {
    mcp?: boolean
    aec?: boolean
  }
  mcp?: XiaozhiV1McpOptions
}

export type XiaozhiV1Connection = Readonly<{
  kind: 'xiaozhi-v1'
  endpoint: string
  accessToken?: string
  deviceId: string
  clientId: string
  instructions?: string
  voiceID?: string
  helloExtension?: Record<string, unknown>
  listeningMode?: ChatListeningMode
  features?: {
    mcp?: boolean
    aec?: boolean
  }
  mcp?: XiaozhiV1McpOptions
}>

/**
 * Opaque connection descriptors accepted by ChatService. Service integrations
 * should construct these through their own factory and a protocol factory such
 * as createXiaozhiV1Connection().
 */
export type ChatConnection = XiaozhiV1Connection

export const XIAOZHI_V1_CONTRACT_VERSION = 1

/** Creates a direct connection to a XiaoZhi WebSocket v1 compatible server. */
export function createXiaozhiV1Connection(options: XiaozhiV1ConnectionOptions): XiaozhiV1Connection {
  if (!options.endpoint) throw new Error('XiaoZhi v1 endpoint is required')
  if (!options.deviceId) throw new Error('XiaoZhi v1 deviceId is required')
  if (!options.clientId) throw new Error('XiaoZhi v1 clientId is required')
  return Object.freeze({ kind: 'xiaozhi-v1' as const, ...options })
}

export type ChatToolSchema = {
  name: string
  description?: string
  parameters?: {
    type: 'object'
    properties: Record<string, { type: string; description?: string; [key: string]: unknown }>
    required?: string[]
    additionalProperties?: boolean
  }
  // Dialogue compatibility.
  inputSchema?: {
    type: 'object'
    properties: Record<string, { type: string; description?: string; [key: string]: unknown }>
    required?: string[]
    additionalProperties?: boolean
  }
}

export type ChatTool = ChatToolSchema & {
  execute?: (params: Record<string, unknown>) => Promise<unknown> | unknown
}

export type ChatAlert = {
  status?: string
  message: string
  emotion?: string
}

export type ChatSystemCommand = {
  command: string
  event: Record<string, unknown>
}

export type ChatCustomEvent = {
  payload: unknown
  event: Record<string, unknown>
}

export type ChatGlyphPush = {
  source: 'stt' | 'tts'
  text?: string
  payload: Record<string, unknown>
}

export type ChatCallbacks = {
  onStateChanged?: (state: ChatStateValue, error?: string) => void
  onInputLevelChanged?: (level: number) => void
  onOutputLevelChanged?: (level: number) => void
  onInputTranscript?: (text: string, more: boolean) => void
  onOutputTranscript?: (text: string, more: boolean) => void
  onFunctionCall?: (call: string, name: string, params: Record<string, unknown>) => void
  onEmotionChanged?: (emotion: string, text?: string) => void
  onAlert?: (alert: ChatAlert) => void
  onSystemCommand?: (command: ChatSystemCommand) => void
  onCustomEvent?: (event: ChatCustomEvent) => void
  onUnknownEvent?: (event: Record<string, unknown>) => void
  onProtocolWarning?: (message: string, event?: Record<string, unknown>) => void
  onMcpNotification?: (payload: Record<string, unknown>) => void
  onMcpResponse?: (payload: Record<string, unknown>) => void
  onGlyphPush?: (glyphPush: ChatGlyphPush) => void
}

type ChatServiceOptions = {
  config?: ChatConfig
  connection?: ChatConnection
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
    properties: Record<string, { type: string; description?: string; [key: string]: unknown }>
    required?: string[]
    additionalProperties?: boolean
  }
}

type ResolvedChatConnection = {
  specifier: string
  configuration?: Record<string, unknown>
  instructions?: string
  voiceID?: string
  providerID?: string
  modelID?: string
  apiKey?: string
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

function resolveConnection(connection: ChatConnection, functions: ChatFunctionSchema[]): ResolvedChatConnection {
  return {
    specifier: 'xiaozhiV1',
    instructions: connection.instructions,
    voiceID: connection.voiceID,
    configuration: {
      protocol: 'xiaozhi-v1',
      endpoint: connection.endpoint,
      authentication: { bearerToken: connection.accessToken },
      identity: { deviceId: connection.deviceId, clientId: connection.clientId },
      helloExtension: connection.helloExtension,
      listeningMode: connection.listeningMode,
      features: {
        mcp: connection.features?.mcp ?? functions.length > 0,
        aec: connection.features?.aec ?? false,
        // glyph_push intentionally remains unadvertised until a renderer is connected.
      },
      mcp: connection.mcp,
    },
  }
}

function resolveLegacyConfig(chatConfig: ChatConfig): ResolvedChatConnection {
  return {
    specifier: chatConfig.specifier ?? String(chatConfig.type),
    instructions: chatConfig.instructions,
    voiceID: chatConfig.voiceID,
    providerID: chatConfig.endpoint ?? chatConfig.providerID,
    modelID: chatConfig.modelID,
    apiKey: chatConfig.apiKey,
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
  static protocolContractVersion(protocol: string): number | undefined {
    if (protocol === 'xiaozhi-v1' && config.xiaozhiV1Available === true) {
      return XIAOZHI_V1_CONTRACT_VERSION
    }
    return undefined
  }

  static supportsProtocol(protocol: string, minimumContractVersion = 1): boolean {
    const version = ChatService.protocolContractVersion(protocol)
    return (
      version !== undefined &&
      Number.isInteger(minimumContractVersion) &&
      minimumContractVersion >= 1 &&
      version >= minimumContractVersion
    )
  }

  #chat: ChatAudioIO
  #state: ChatStateValue = ChatState.DISCONNECTED
  #error = ''
  #callbacks: Required<ChatCallbacks>
  #sessionState: ChatSessionState

  constructor(options: ChatServiceOptions) {
    if ((options.config ? 1 : 0) + (options.connection ? 1 : 0) !== 1) {
      throw new Error('ChatService requires exactly one of config or connection')
    }

    this.#sessionState = options.sessionState ?? new ChatSessionState()
    const callbacks = options.callbacks ?? {}
    this.#callbacks = {
      onStateChanged: callbacks.onStateChanged ?? noop,
      onInputLevelChanged: callbacks.onInputLevelChanged ?? noop,
      onOutputLevelChanged: callbacks.onOutputLevelChanged ?? noop,
      onInputTranscript: callbacks.onInputTranscript ?? noop,
      onOutputTranscript: callbacks.onOutputTranscript ?? noop,
      onFunctionCall: callbacks.onFunctionCall ?? noop,
      onEmotionChanged: callbacks.onEmotionChanged ?? noop,
      onAlert: callbacks.onAlert ?? noop,
      onSystemCommand: callbacks.onSystemCommand ?? noop,
      onCustomEvent: callbacks.onCustomEvent ?? noop,
      onUnknownEvent: callbacks.onUnknownEvent ?? noop,
      onProtocolWarning: callbacks.onProtocolWarning ?? noop,
      onMcpNotification: callbacks.onMcpNotification ?? noop,
      onMcpResponse: callbacks.onMcpResponse ?? noop,
      onGlyphPush: callbacks.onGlyphPush ?? noop,
    }

    const functions = Object.values(options.tools ?? {})
      .map((tool) => toFunctionSchema(tool))
      .filter((schema): schema is ChatFunctionSchema => schema != null)

    const resolved = options.connection
      ? resolveConnection(options.connection, functions)
      : resolveLegacyConfig(options.config as ChatConfig)
    if (resolved.specifier === 'xiaozhiV1' && !ChatService.supportsProtocol('xiaozhi-v1')) {
      throw new Error('The selected realtime protocol is unavailable on this target')
    }

    const ChatAudioIOCtor =
      options.chatAudioIOCtor ??
      (ChatAudioIO as unknown as {
        new (chatOptions: Record<string, unknown>): ChatAudioIO
      })
    const chatAudioIOConstants = ChatAudioIOCtor as unknown as ChatAudioIOStateConstants
    this.#chat = new ChatAudioIOCtor({
      specifier: resolved.specifier,
      configuration: resolved.configuration,
      instructions: resolved.instructions,
      voiceID: resolved.voiceID,
      providerID: resolved.providerID,
      modelID: resolved.modelID,
      apiKey: resolved.apiKey,
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
      onEmotionChanged: (emotion: string, text?: string) => this.#callbacks.onEmotionChanged(emotion, text),
      onAlert: (alert: ChatAlert) => this.#callbacks.onAlert(alert),
      onSystemCommand: (command: ChatSystemCommand) => this.#callbacks.onSystemCommand(command),
      onCustomEvent: (event: ChatCustomEvent) => this.#callbacks.onCustomEvent(event),
      onUnknownEvent: (event: Record<string, unknown>) => this.#callbacks.onUnknownEvent(event),
      onProtocolWarning: (message: string, event?: Record<string, unknown>) =>
        this.#callbacks.onProtocolWarning(message, event),
      onMcpNotification: (payload: Record<string, unknown>) => this.#callbacks.onMcpNotification(payload),
      onMcpResponse: (payload: Record<string, unknown>) => this.#callbacks.onMcpResponse(payload),
      onGlyphPush: (glyphPush: ChatGlyphPush) => this.#callbacks.onGlyphPush(glyphPush),
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

  startListening(mode: ChatListeningMode = 'auto'): void {
    const extension = this.#chat as unknown as { startListening?: (mode: ChatListeningMode) => void }
    if (!extension.startListening) throw new Error('The active chat transport does not support explicit listening')
    extension.startListening(mode)
  }

  stopListening(): void {
    const extension = this.#chat as unknown as { stopListening?: () => void }
    if (!extension.stopListening) throw new Error('The active chat transport does not support explicit listening')
    extension.stopListening()
  }

  notifyWakeWordDetected(text?: string): void {
    const extension = this.#chat as unknown as { notifyWakeWordDetected?: (text?: string) => void }
    if (!extension.notifyWakeWordDetected) {
      throw new Error('The active chat transport does not support wake-word notification')
    }
    extension.notifyWakeWordDetected(text)
  }

  abort(reason?: string): void {
    const extension = this.#chat as unknown as { abort?: (reason?: string) => void }
    if (!extension.abort) throw new Error('The active chat transport does not support abort')
    extension.abort(reason)
  }

  sendMcpMessage(payload: Record<string, unknown>): void {
    const extension = this.#chat as unknown as { sendMcpMessage?: (payload: Record<string, unknown>) => void }
    if (!extension.sendMcpMessage) throw new Error('The active chat transport does not support MCP')
    extension.sendMcpMessage(payload)
  }
}
