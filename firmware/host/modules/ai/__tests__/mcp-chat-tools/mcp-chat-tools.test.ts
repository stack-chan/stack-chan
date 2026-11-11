import { toolsFromMCP } from 'stackchan/ai'
import { assert, equal } from 'testing/assert'

trace('=== mcp-chat-tools test ===\n')

async function runTest() {
  const mcpTools = await toolsFromMCP({
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
  })

  equal(mcpTools.length, 1, 'MCP tool should expose a function definition')
  const remoteEcho = mcpTools.find((tool) => tool.definition.name === 'remoteEcho')
  assert(remoteEcho, 'MCP remoteEcho tool should exist')
  if (!remoteEcho?.execute) {
    throw new Error('MCP remoteEcho tool should exist')
  }
  const result = (await remoteEcho.execute({ value: 'ok' }, {} as never)) as { content: { text: string }[] }
  equal(result.content[0].text, 'remoteEcho:ok', 'MCP tool preserves the remote response')

  trace('@@STACKCHAN_TEST:PASS@@\n')
}

runTest().catch((error) => {
  trace('@@STACKCHAN_TEST:FAIL@@\n')
  trace(`${error}\n`)
  throw error
})
