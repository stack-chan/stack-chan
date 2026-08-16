import ChatAudioIO from 'testing/fakes/ChatAudioIO'

type ChatAudioIOBase = InstanceType<typeof ChatAudioIO>

import {
  type ChatConfig,
  ChatService,
  ChatState,
  type ChatState as ChatStateValue,
  type ChatTool,
  MAX_TRANSCRIPT_CHARS,
} from 'chat'
import { assert, equal } from 'testing/assert'
import Timer from 'timer'

trace('=== chat-service test ===\n')

const tools: Record<string, ChatTool> = {
  sample: {
    name: 'sample',
    description: 'sample tool',
    parameters: {
      type: 'object' as const,
      properties: {
        foo: { type: 'string' },
      },
      required: ['foo'],
      additionalProperties: false,
    },
    execute: () => 'ok',
  },
}

const states: ChatStateValue[] = []
const service = new ChatService({
  config: {
    type: 'xiaozhi',
    specifier: 'stackchanXiaozhi',
    endpoint: 'ws://192.168.7.140:8787/device/v1/realtime',
    modelID: 'stackchan-ai',
    apiKey: 'test-api-key',
  },
  tools,
  chatAudioIOCtor: ChatAudioIO as unknown as new (chatOptions: Record<string, unknown>) => ChatAudioIOBase,
  callbacks: {
    onStateChanged: (state: ChatStateValue) => states.push(state),
  },
})

const ChatAudioIOAny = ChatAudioIO as unknown as {
  lastOptions?: {
    specifier?: string
    providerID?: string
    apiKey?: string
    functions?: { name: string }[]
  }
  instances?: {
    emitState: (state: number) => void
    emitInputTranscript: (text: string, more?: boolean) => void
    emitOutputTranscript: (text: string, more?: boolean) => void
    emitFunctionCall: (call: string, name: string, parameters: Record<string, unknown>) => void
    lastText?: string
    lastFunctionResult?: { call: string }
  }[]
  CONNECTED?: number
}

const lastOptions = ChatAudioIOAny.lastOptions
assert(lastOptions, 'ChatAudioIO options should be captured')
if (!lastOptions) {
  throw new Error('ChatAudioIO options should be captured')
}
const functions = lastOptions.functions ?? []
equal(lastOptions.specifier, 'stackchanXiaozhi', 'an explicit worker specifier should override the chat type')
equal(
  lastOptions.providerID,
  'ws://192.168.7.140:8787/device/v1/realtime',
  'endpoint should be forwarded through the provider configuration slot',
)
equal(lastOptions.apiKey, 'test-api-key', 'api key should be forwarded to ChatAudioIO')
equal(functions.length, 1, 'functions length')
equal(functions[0] ? functions[0].name : undefined, 'sample', 'function name')

service.start()
equal(states[0], ChatState.CONNECTING, 'state should map to CONNECTING')

const instance = ChatAudioIOAny.instances ? ChatAudioIOAny.instances[0] : undefined
assert(instance, 'ChatAudioIO instance should exist')
if (!instance) {
  throw new Error('ChatAudioIO instance should exist')
}
const connectedState = ChatAudioIOAny.CONNECTED
assert(connectedState !== undefined, 'ChatAudioIO CONNECTED constant should exist')
if (connectedState === undefined) {
  throw new Error('ChatAudioIO CONNECTED constant should exist')
}
instance.emitState(connectedState)
equal(states[1], ChatState.CONNECTED, 'state should map to CONNECTED')

service.sendText('hello')
equal(instance.lastText, 'hello', 'sendText forwards to ChatAudioIO')

instance.emitInputTranscript('hel', true)
instance.emitInputTranscript('lo', false)
instance.emitOutputTranscript('hi', false)
equal(service.transcript.input, 'hello', 'input transcript should be kept by conversation state')
equal(service.transcript.output, 'hi', 'output transcript should be kept by conversation state')

let longChunk = ''
for (let i = 0; i < 128; i += 1) {
  longChunk += '0123456789abcdef'
}
for (let i = 0; i < 3; i += 1) {
  instance.emitOutputTranscript(longChunk, true)
}
equal(service.transcript.output.length, MAX_TRANSCRIPT_CHARS, 'output transcript should keep a bounded tail')

instance.emitFunctionCall('call-1', 'sample', { foo: 'bar' })
const requestedCall = service.functionCalls[0]
equal(requestedCall ? requestedCall.name : undefined, 'sample', 'function call name should be kept')
equal(requestedCall ? requestedCall.status : undefined, 'requested', 'function call starts as requested')

service.sendFunctionResult('call-1', 'sample', { ok: true })
equal(
  instance.lastFunctionResult ? instance.lastFunctionResult.call : undefined,
  'call-1',
  'sendFunctionResult forwards call id',
)
const completedCall = service.functionCalls[0]
equal(completedCall ? completedCall.status : undefined, 'completed', 'function result should complete the call')

service.stop()
equal(states[2], ChatState.DISCONNECTING, 'state should map to DISCONNECTING')
equal(states[3], ChatState.DISCONNECTED, 'state should map to DISCONNECTED')

service.start()
equal(service.transcript.input, '', 'start should clear input transcript for the next session')
equal(service.transcript.output, '', 'start should clear output transcript for the next session')

const defaultService = new ChatService({
  config: {
    type: 'deepgramAgent',
    providerID: 'deepgram',
  },
  chatAudioIOCtor: ChatAudioIO as unknown as new (chatOptions: Record<string, unknown>) => ChatAudioIOBase,
})
const defaultOptions = ChatAudioIOAny.lastOptions
assert(defaultOptions, 'default ChatAudioIO options should be captured')
equal(defaultOptions?.specifier, 'deepgramAgent', 'a chat type should remain the default worker specifier')
equal(defaultOptions?.providerID, 'deepgram', 'a provider ID should remain unchanged without an endpoint override')
defaultService.close()

let legacyError = ''
try {
  new ChatService({ config: { type: 'openAIRealtime' } as unknown as ChatConfig })
} catch (error) {
  legacyError = String(error)
}
equal(legacyError.includes('migrate ChatConfig.type to xiaozhi'), true, 'legacy chat config should require migration')

const xiaozhiService = new ChatService({
  config: { type: 'xiaozhi' },
  chatAudioIOCtor: ChatAudioIO as unknown as new (chatOptions: Record<string, unknown>) => ChatAudioIOBase,
})
equal(ChatAudioIOAny.lastOptions?.specifier, 'stackchanXiaozhi', 'XiaoZhi should select its worker specifier')
xiaozhiService.close()

trace('ok\n')
Timer.set(() => {}, 1000)
