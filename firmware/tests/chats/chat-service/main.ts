import type ChatAudioIOBase from 'ChatAudioIO'
import { ChatService, type ChatState, type ChatTool } from 'chat'
import { assert, equal } from 'mocks/assert'
import ChatAudioIO from 'mocks/ChatAudioIO'

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
  instances?: { emitState: (state: number) => void; lastText?: string; lastFunctionResult?: { call: string } }[]
  CONNECTED?: number
}

assert(ChatAudioIOAny.lastOptions, 'ChatAudioIO options should be captured')
equal(ChatAudioIOAny.lastOptions?.specifier, 'openAIRealtime', 'chat type should map to ChatAudioIO specifier')
equal(ChatAudioIOAny.lastOptions?.functions?.length ?? 0, 1, 'functions length')
equal(ChatAudioIOAny.lastOptions?.functions?.[0]?.name, 'sample', 'function name')

service.start()
equal(states[0], 'CONNECTING', 'state should map to CONNECTING')

const instance = ChatAudioIOAny.instances?.[0]
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

service.sendFunctionResult('call-1', 'sample', { ok: true })
equal(instance.lastFunctionResult?.call, 'call-1', 'sendFunctionResult forwards call id')

service.stop()
equal(states[2], 'DISCONNECTING', 'state should map to DISCONNECTING')
equal(states[3], 'DISCONNECTED', 'state should map to DISCONNECTED')

trace('ok\n')
