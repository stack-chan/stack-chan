import { emotionNames } from 'rom-tool-schema'
import { createToolSet, toolsFromMCP } from 'stackchan/ai'
import { assert, equal } from 'testing/assert'

trace('=== mcp-chat-tools test ===\n')

async function runTest() {
  let isReadOnly = false
  try {
    JSON.stringify(emotionNames)
  } catch {
    isReadOnly = true
  }
  assert(isReadOnly, 'fixture must exercise an XS preloaded array')
  const parameters = {
    type: 'object',
    properties: { emotion: { type: 'string', enum: emotionNames } },
    required: ['emotion'],
    additionalProperties: false,
  }
  const snapshot = createToolSet([
    {
      definition: { type: 'function', name: 'emotion', description: 'Choose emotion', parameters },
      execute: () => null,
    },
  ]).definitions
  equal(JSON.parse(JSON.stringify(snapshot))[0].parameters.properties.emotion.enum[0], 'HAPPY')
  parameters.properties.emotion.type = 'number'
  equal(
    (snapshot[0].parameters as typeof parameters).properties.emotion.type,
    'string',
    'schema snapshot is independent',
  )
  assert(
    Object.isFrozen(snapshot) && Object.isFrozen((snapshot[0].parameters as typeof parameters).properties.emotion.enum),
  )
  equal(emotionNames[0], 'HAPPY', 'source schema stays unchanged')
  const namedProperties = JSON.parse('{"__proto__":{"type":"string"}}')
  const special = createToolSet([
    {
      definition: {
        type: 'function',
        name: 'special',
        description: 'Special property',
        parameters: { type: 'object', properties: namedProperties },
        strict: undefined,
      },
      execute: () => null,
    },
  ]).definitions[0]
  assert(Object.hasOwn((special.parameters as { properties: object }).properties, '__proto__'))
  assert(!Object.hasOwn(special, 'strict'), 'optional undefined retains JSON omission semantics')
  const circular: Record<string, unknown> = {}
  circular.self = circular
  let rejectedCycle = false
  try {
    createToolSet([
      {
        definition: {
          type: 'function',
          name: 'cycle',
          description: 'Circular schema',
          parameters: { enum: [circular] } as never,
        },
        execute: () => null,
      },
    ])
  } catch {
    rejectedCycle = true
  }
  assert(rejectedCycle, 'circular JSON remains an explicit error')
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
