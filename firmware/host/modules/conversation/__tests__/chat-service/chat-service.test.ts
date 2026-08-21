import ChatAudioIO from 'testing/fakes/ChatAudioIO'

type ChatAudioIOBase = InstanceType<typeof ChatAudioIO>

import {
  type ChatConfig,
  ChatService,
  ChatState,
  type ChatState as ChatStateValue,
  type ChatTool,
  createXiaozhiV1Connection,
  MAX_TRANSCRIPT_CHARS,
} from 'chat'
import { assert, equal } from 'testing/assert'
import Timer from 'timer'

trace('=== chat-service test ===\n')

equal(ChatService.protocolContractVersion('xiaozhi-v1'), 1, 'host exposes the XiaoZhi contract version')
equal(ChatService.supportsProtocol('xiaozhi-v1'), true, 'host reports XiaoZhi v1 support')
equal(ChatService.supportsProtocol('xiaozhi-v1', 2), false, 'host rejects a newer required contract')
equal(ChatService.supportsProtocol('unknown'), false, 'host rejects unknown connection protocols')

const tools: Record<string, ChatTool> = {
  sample: {
    name: 'sample',
    description: 'sample tool',
    parameters: {
      type: 'object' as const,
      properties: { foo: { type: 'string' } },
      required: ['foo'],
      additionalProperties: false,
    },
    execute: () => 'ok',
  },
}

const states: ChatStateValue[] = []
const connection = createXiaozhiV1Connection({
  endpoint: 'wss://xiaozhi.example.test/ws',
  accessToken: 'test-api-key',
  deviceId: 'physical-1',
  clientId: 'client-1',
  helloExtension: { vendor_agent: 'agent-1' },
  listeningMode: 'manual',
  features: { aec: true },
  mcp: { serverInfo: { name: 'stack-chan', version: 'test' } },
})
const service = new ChatService({
  connection,
  tools,
  chatAudioIOCtor: ChatAudioIO as unknown as new (chatOptions: Record<string, unknown>) => ChatAudioIOBase,
  callbacks: {
    onStateChanged: (state: ChatStateValue) => states.push(state),
  },
})

const ChatAudioIOAny = ChatAudioIO as unknown as {
  lastOptions?: {
    specifier?: string
    providerID?: unknown
    apiKey?: string
    functions?: { name: string }[]
    configuration?: {
      protocol?: string
      endpoint?: string
      identity?: {
        deviceId?: string
        clientId?: string
      }
      helloExtension?: Record<string, unknown>
      features?: {
        mcp?: boolean
        aec?: boolean
        glyph_push?: boolean
      }
    }
  }
  instances?: (ChatAudioIOBase & {
    lastListeningMode?: string
    stopListeningCount?: number
    lastWakeWord?: string
    lastAbortReason?: string
    lastMcpPayload?: Record<string, unknown>
    lastText?: string
    lastFunctionResult?: { call: string }
  })[]
  CONNECTED?: number
}

const lastOptions = ChatAudioIOAny.lastOptions
assert(lastOptions, 'ChatAudioIO options should be captured')
if (!lastOptions) throw new Error('ChatAudioIO options should be captured')
equal(lastOptions.specifier, 'xiaozhiV1', 'XiaoZhi connections should select the generic protocol worker')
equal(lastOptions.providerID, undefined, 'new connections should not overload providerID')
equal(lastOptions.apiKey, undefined, 'new connections should not overload apiKey')
equal(lastOptions.configuration?.protocol, 'xiaozhi-v1', 'the internal protocol is selected structurally')
equal(lastOptions.configuration?.endpoint, 'wss://xiaozhi.example.test/ws')
equal(lastOptions.configuration?.identity?.deviceId, 'physical-1', 'deviceId maps to Device-Id')
equal(lastOptions.configuration?.identity?.clientId, 'client-1', 'clientId maps to Client-Id')
equal(lastOptions.configuration?.helloExtension?.vendor_agent, 'agent-1', 'generic hello extensions are preserved')
equal(lastOptions.configuration?.features?.mcp, true, 'registered tools advertise MCP')
equal(lastOptions.configuration?.features?.aec, true, 'AEC is explicitly advertised')
equal(lastOptions.configuration?.features?.glyph_push, undefined, 'glyph push remains unadvertised')
equal(lastOptions.functions?.length, 1, 'tool schemas should reach the worker')

service.start()
equal(states[0], ChatState.CONNECTING, 'state should map to CONNECTING')
const instance = ChatAudioIOAny.instances?.[0]
assert(instance, 'ChatAudioIO instance should exist')
if (!instance) throw new Error('ChatAudioIO instance should exist')
const connectedState = ChatAudioIOAny.CONNECTED
assert(connectedState !== undefined, 'ChatAudioIO CONNECTED constant should exist')
if (connectedState === undefined) throw new Error('ChatAudioIO CONNECTED constant should exist')
instance.emitState(connectedState)
equal(states[1], ChatState.CONNECTED, 'state should map to CONNECTED')

service.sendText('hello')
equal(instance.lastText, 'hello', 'sendText forwards to ChatAudioIO')
service.startListening('realtime')
equal(instance.lastListeningMode, 'realtime', 'explicit listening mode should reach the worker')
service.stopListening()
equal(instance.stopListeningCount, 1, 'stop listening should reach the worker')
service.notifyWakeWordDetected('Hi Stack-chan')
equal(instance.lastWakeWord, 'Hi Stack-chan', 'wake-word detection should reach the worker')
service.abort('wake_word_detected')
equal(instance.lastAbortReason, 'wake_word_detected', 'abort reason should reach the worker')
const notification = { jsonrpc: '2.0', method: 'notifications/test', params: { ok: true } }
service.sendMcpMessage(notification)
equal(instance.lastMcpPayload, notification, 'outbound MCP should reach the worker')

instance.emitInputTranscript('hel', true)
instance.emitInputTranscript('lo', false)
instance.emitOutputTranscript('hi', false)
equal(service.transcript.input, 'hello', 'input transcript should be kept by conversation state')
equal(service.transcript.output, 'hi', 'output transcript should be kept by conversation state')
let longChunk = ''
for (let i = 0; i < 128; i += 1) longChunk += '0123456789abcdef'
for (let i = 0; i < 3; i += 1) instance.emitOutputTranscript(longChunk, true)
equal(service.transcript.output.length, MAX_TRANSCRIPT_CHARS, 'output transcript should keep a bounded tail')

instance.emitFunctionCall('call-1', 'sample', { foo: 'bar' })
equal(service.functionCalls[0]?.status, 'requested', 'function call starts as requested')
service.sendFunctionResult('call-1', 'sample', { ok: true })
equal(instance.lastFunctionResult?.call, 'call-1', 'sendFunctionResult forwards call id')
equal(service.functionCalls[0]?.status, 'completed', 'function result should complete the call')

const legacyOpenAI = new ChatService({
  config: { type: 'openAIRealtime', endpoint: 'wss://relay.example.test/openai' } as ChatConfig,
  chatAudioIOCtor: ChatAudioIO as unknown as new (chatOptions: Record<string, unknown>) => ChatAudioIOBase,
})
equal(ChatAudioIOAny.lastOptions?.specifier, 'openAIRealtime', 'legacy OpenAI ChatConfig remains compatible')
legacyOpenAI.close()

service.stop()
equal(states[2], ChatState.DISCONNECTING, 'state should map to DISCONNECTING')
equal(states[3], ChatState.DISCONNECTED, 'state should map to DISCONNECTED')

trace('ok\n')
Timer.set(() => {}, 1000)
