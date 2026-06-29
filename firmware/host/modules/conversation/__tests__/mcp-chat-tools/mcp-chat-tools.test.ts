import { createMCPChatTools } from 'mcp-tools'
import { assert, equal } from 'testing/assert'

trace('=== mcp-chat-tools test ===\n')

async function runTest() {
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
  const remoteEcho = mcpTools.remoteEcho
  assert(remoteEcho, 'MCP remoteEcho tool should exist')
  if (!remoteEcho?.execute) {
    throw new Error('MCP remoteEcho tool should exist')
  }
  equal(await remoteEcho.execute({ value: 'ok' }), 'remoteEcho:ok', 'MCP tool result should normalize')

  trace('ok\n')
}

runTest().catch((error) => {
  trace(`${error}\n`)
  throw error
})
