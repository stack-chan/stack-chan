import ChatAudioIO from 'StackChanChatAudioIO'
import { ChatState, type ChatState as ChatStateValue } from 'chat-state'
import config from 'mc/config'
import type { CloseResult, Conversation, PlaybackReceipt, ToolSet } from 'stackchan/voice/contracts'
import { createVoiceScope, deferred, requireActive, voiceError } from 'stackchan/voice/scope'
import Timer from 'timer'

export { ChatState, type ChatStateName, ChatStateNames, chatStateToName } from 'chat-state'

export type ChatType = 'deepgramAgent' | 'elevenLabsAgent' | 'googleGeminiLive' | 'humeAIEVI' | 'openAIRealtime'

/** Provider settings for an SDK chat worker. */
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
 * Connection descriptors accepted by ChatConversation.create(). Service integrations
 * should construct these through their own factory and a protocol factory such
 * as XiaoZhiV1Connection.create().
 */
export type ChatConnection = XiaozhiV1Connection

export const XIAOZHI_V1_CONTRACT_VERSION = 1

/** Creates a direct connection to a XiaoZhi WebSocket v1 compatible server. */
function createXiaozhiV1Connection(options: XiaozhiV1ConnectionOptions): XiaozhiV1Connection {
  if (!options.endpoint) throw new Error('XiaoZhi v1 endpoint is required')
  if (!options.deviceId) throw new Error('XiaoZhi v1 deviceId is required')
  if (!options.clientId) throw new Error('XiaoZhi v1 clientId is required')
  return Object.freeze({ kind: 'xiaozhi-v1' as const, ...options })
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

type ResolvedChatConnection = {
  specifier: string
  configuration?: Record<string, unknown>
  instructions?: string
  voiceID?: string
  providerID?: string
  modelID?: string
  apiKey?: string
}

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

function resolveConnection(connection: ChatConnection, functions: readonly unknown[]): ResolvedChatConnection {
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

function resolveWorkerConfig(chatConfig: ChatConfig | undefined): ResolvedChatConnection {
  if (!chatConfig) throw new TypeError('Missing Chat worker configuration')
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

let chatSessionSerial = 0
const workerRates = Object.freeze({
  openAIRealtime: [8000, 24000],
  deepgramAgent: [8000, 16000],
  humeAIEVI: [8000, 48000],
  googleGeminiLive: [24000, 24000],
  elevenLabsAgent: [16000, 16000],
  xiaozhiV1: [16000, 24000],
})
type ChatVoiceIO = ChatAudioIO & {
  drain(): Promise<void>
  fence(): Promise<PlaybackReceipt[]>
}
function createChatConversation(options: {
  config?: ChatConfig
  connection?: ChatConnection
  tools?: ToolSet
  callbacks?: ChatCallbacks
  chatAudioIOCtor?: new (options: Record<string, unknown>) => ChatVoiceIO
}): Conversation {
  if (!!options.connection === !!options.config) throw new TypeError('Choose a connection or configuration')
  const functions = options.tools?.definitions.map(({ name, description, parameters }) => ({
    name,
    description,
    parameters,
  }))
  const connection = options.connection
    ? resolveConnection(options.connection, functions ?? [])
    : resolveWorkerConfig(options.config)
  if (connection.specifier === 'xiaozhiV1' && config.xiaozhiV1Available !== true)
    throw voiceError('unsupported_capability', 'XiaoZhi unavailable on this target')
  const rates = workerRates[connection.specifier]
  const textInput = connection.specifier !== 'xiaozhiV1'
  if (!rates) throw voiceError('unsupported_capability', 'Unknown worker audio format')
  const format = (sampleRate: number) => ({ encoding: 'pcm_s16le' as const, channels: 1 as const, sampleRate })
  return {
    capabilities: {
      interruption: 'local-only',
      interruptionReuse: 'restart-required',
      historyRepair: 'restart',
      imageInput: false,
      textInput,
      inputRoles: textInput ? ['user'] : [],
      turnControl: 'provider',
      submitCompletion: 'unavailable',
    },
    audio: { input: [format(rates[0])], output: [format(rates[1])], duplex: 'half' },
    async open({ media, history, signal, onEvent }) {
      requireActive(signal)
      if (history.length) throw voiceError('unsupported_capability', 'Chat worker cannot import history')
      const id = 'chat-' + ++chatSessionSerial
      const scope = createVoiceScope(signal),
        ready = deferred<void>(),
        ended = deferred<boolean>()
      const callbacks = options.callbacks ?? {}
      const Ctor = options.chatAudioIOCtor ?? (ChatAudioIO as unknown as NonNullable<typeof options.chatAudioIOCtor>)
      const constants = Ctor as unknown as ChatAudioIOStateConstants
      let io!: ChatVoiceIO
      let outputId = '',
        utterance = 0,
        inputText = '',
        settled = false,
        stopping = false
      let closing: Promise<CloseResult>,
        playback: PlaybackReceipt[] = []
      const deadline = Timer.set(() => ready.reject(voiceError('deadline_exceeded')), 30000)
      const cancel = () => ready.reject(voiceError('cancelled'))
      signal.addEventListener('abort', cancel)
      async function execute(call: string, name: string, args: Record<string, unknown>) {
        if (scope.signal.aborted) return
        callbacks.onFunctionCall?.(call, name, args)
        if (!options.tools) throw voiceError('unsupported_capability', 'Tool unavailable')
        const result = await options.tools.execute(
          { type: 'function_call', id: call, call_id: call, name, arguments: JSON.stringify(args) },
          { sessionId: id, turnId: 'utterance-' + utterance, callId: call, signal: scope.signal },
        )
        if (!scope.signal.aborted) io.sendFunctionResult(call, name, result.output)
      }
      try {
        io = new Ctor({
          ...connection,
          functions,
          ...callbacks,
          media,
          onOutputStarted(value: string) {
            outputId = value
            onEvent({ type: 'turn.started', turnId: outputId })
          },
          onPlayback(receipt: PlaybackReceipt) {
            onEvent({ type: 'output.playback', receipt })
            const status = receipt.state === 'played' ? 'completed' : receipt.state
            onEvent({ type: 'turn.ended', turnId: receipt.outputId, status })
          },
          onStateChanged(value: number) {
            const state = mapState(value, constants)
            if (state === ChatState.CONNECTED) ready.resolve()
            if (state === ChatState.DISCONNECTED || state === ChatState.FAILED) {
              ended.resolve(state === ChatState.DISCONNECTED)
              if (!settled) ready.reject(voiceError('provider_failed', io?.error || 'Worker disconnected'))
              else if (!stopping) onEvent({ type: 'error', code: 'provider_closed', fatal: true })
            }
            callbacks.onStateChanged?.(state, io?.error)
          },
          onInputTranscript(text: string, more: boolean) {
            if (stopping) return
            callbacks.onInputTranscript?.(text, more)
            if (inputText.length + text.length > 8192) {
              onEvent({ type: 'error', code: 'resource_exhausted', fatal: true })
              return
            }
            inputText += text
            onEvent({
              type: 'input.transcript',
              value: { text: inputText, final: !more, utteranceId: id + '/utterance-' + utterance },
            })
            if (!more) {
              utterance++
              inputText = ''
            }
          },
          onOutputTranscript(text: string, more: boolean, itemId?: string) {
            if (stopping) return
            callbacks.onOutputTranscript?.(text, more)
            if (text) onEvent({ type: 'output.text', outputId: itemId ?? outputId, delta: text })
          },
          onFunctionCall(call, name, args) {
            void execute(call, name, args).catch(() => {
              if (!scope.signal.aborted) io.sendFunctionResult(call, name, { error: 'tool_failed' })
            })
          },
        })
        io.connect()
        await ready.promise
        requireActive(signal)
        settled = true
      } catch (error) {
        scope.abort(error)
        try {
          await io?.fence?.()
        } finally {
          try {
            io?.close()
          } finally {
            scope.dispose()
          }
        }
        throw error
      } finally {
        signal.removeEventListener('abort', cancel)
        Timer.clear(deadline)
      }
      function stop(mode: 'abort' | 'drain', timeoutMs = 3000) {
        if (closing) return closing
        stopping = true
        scope.abort()
        closing = Promise.resolve().then(async () => {
          let timer: ReturnType<typeof Timer.set> | undefined,
            reason: CloseResult['reason'] = mode === 'drain' ? 'drained' : 'aborted'
          const expired = new Promise<boolean>((resolve) => {
            timer = Timer.set(() => resolve(false), Math.max(1, timeoutMs))
          })
          let confirmed = false
          try {
            io.changeMicrophone(false)
            if (mode === 'drain' && !(await Promise.race([io.drain().then(() => true), expired])))
              reason = 'drain-timeout'
            if (reason !== 'drained') {
              playback = await io.fence()
              for (const receipt of playback) {
                onEvent({ type: 'output.playback', receipt })
                onEvent({ type: 'turn.ended', turnId: receipt.outputId, status: 'interrupted' })
              }
            }
            io.disconnect()
            confirmed = await Promise.race([ended.promise, expired])
          } finally {
            if (timer !== undefined) Timer.clear(timer)
            try {
              io.close()
            } finally {
              scope.dispose()
            }
          }
          return { reason, remoteFinalization: confirmed ? ('confirmed' as const) : ('unknown' as const) }
        })
        return closing
      }
      return {
        id,
        async submit(message, scope) {
          requireActive(scope.signal)
          if (stopping) throw voiceError('cancelled')
          if (!textInput || message.role !== 'user' || message.content.some((part) => part.type !== 'input_text'))
            throw voiceError('unsupported_capability')
          const text = message.content.map((part) => (part.type === 'input_text' ? part.text : '')).join('')
          if (text.length > 8192) throw voiceError('resource_exhausted')
          io.sendText(text)
          return { completion: 'unavailable' as const }
        },
        async setInputEnabled(enabled) {
          if (stopping) throw voiceError('cancelled')
          io.changeMicrophone(enabled)
        },
        async interrupt() {
          const result = await stop('abort', 1500)
          return {
            playback,
            remote: result.remoteFinalization === 'confirmed' ? 'cancelled' : 'unknown',
            history: 'restart-required',
          }
        },
        close: ({ mode, timeoutMs }) => stop(mode, timeoutMs),
      }
    },
  }
}

export const ChatConversation = Object.freeze({ create: createChatConversation })
export const XiaoZhiV1Connection = Object.freeze({ create: createXiaozhiV1Connection })
