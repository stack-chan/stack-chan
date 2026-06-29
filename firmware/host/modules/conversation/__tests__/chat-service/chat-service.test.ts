import type ChatAudioIOBase from 'ChatAudioIO'
import ChatAudioIO from 'ChatAudioIO'
import { ChatService, type ChatState, type ChatTool } from 'chat'
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

const states: ChatState[] = []
const service = new ChatService({
  config: { type: 'openAIRealtime', modelID: 'gpt-realtime-mini' },
  tools,
  chatAudioIOCtor: ChatAudioIO as unknown as new (chatOptions: Record<string, unknown>) => ChatAudioIOBase,
  callbacks: {
    onStateChanged: (state: ChatState) => states.push(state),
  },
})

const ChatAudioIOAny = ChatAudioIO as unknown as {
  lastOptions?: { specifier?: string; functions?: { name: string }[] }
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
equal(lastOptions.specifier, 'openAIRealtime', 'chat type should map to ChatAudioIO specifier')
equal(functions.length, 1, 'functions length')
equal(functions[0] ? functions[0].name : undefined, 'sample', 'function name')

service.start()
equal(states[0], 'CONNECTING', 'state should map to CONNECTING')

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
equal(states[1], 'CONNECTED', 'state should map to CONNECTED')

service.sendText('hello')
equal(instance.lastText, 'hello', 'sendText forwards to ChatAudioIO')

instance.emitInputTranscript('hel', true)
instance.emitInputTranscript('lo', false)
instance.emitOutputTranscript('hi', false)
equal(service.transcript.input, 'hello', 'input transcript should be kept by conversation state')
equal(service.transcript.output, 'hi', 'output transcript should be kept by conversation state')

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
equal(states[2], 'DISCONNECTING', 'state should map to DISCONNECTING')
equal(states[3], 'DISCONNECTED', 'state should map to DISCONNECTED')

trace('ok\n')
Timer.set(() => {}, 1000)
