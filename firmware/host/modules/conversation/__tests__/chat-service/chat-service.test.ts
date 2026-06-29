import type ChatAudioIOBase from 'ChatAudioIO'
import ChatAudioIO from 'ChatAudioIO'
import { ChatService, type ChatState, type ChatTool } from 'chat'
import { createMCPChatTools } from 'mcp-tools'
import { assert, equal } from 'testing/assert'

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

async function runTest() {
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

  instance.emitInputTranscript('hel', true)
  instance.emitInputTranscript('lo', false)
  instance.emitOutputTranscript('hi', false)
  equal(service.transcript.input, 'hello', 'input transcript should be kept by conversation state')
  equal(service.transcript.output, 'hi', 'output transcript should be kept by conversation state')

  instance.emitFunctionCall('call-1', 'sample', { foo: 'bar' })
  equal(service.functionCalls[0]?.name, 'sample', 'function call name should be kept')
  equal(service.functionCalls[0]?.status, 'requested', 'function call starts as requested')

  service.sendFunctionResult('call-1', 'sample', { ok: true })
  equal(instance.lastFunctionResult?.call, 'call-1', 'sendFunctionResult forwards call id')
  equal(service.functionCalls[0]?.status, 'completed', 'function result should complete the call')

  const mcpTools = await createMCPChatTools([
    {
      listTools: async () => ({
        tools: [
          {
            name: 'remoteEcho',
            description: 'remote echo',
            inputSchema: {
              type: 'object' as const,
              properties: { value: { type: 'string' } },
              required: ['value'],
            },
          },
        ],
      }),
      callTool: async (name: string, params: Record<string, unknown>) => ({
        content: [{ type: 'text' as const, text: `${name}:${params.value}` }],
      }),
    } as never,
  ])
  equal(Object.keys(mcpTools).length, 1, 'MCP tool should become ChatTool')
  equal(await mcpTools.remoteEcho?.execute?.({ value: 'ok' }), 'remoteEcho:ok', 'MCP tool result should normalize')

  service.stop()
  equal(states[2], 'DISCONNECTING', 'state should map to DISCONNECTING')
  equal(states[3], 'DISCONNECTED', 'state should map to DISCONNECTED')

  trace('ok\n')
}

runTest().catch((error) => {
  trace(`not ok ${error}\n`)
  throw error
})
