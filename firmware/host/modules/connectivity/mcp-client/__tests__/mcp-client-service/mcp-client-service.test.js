import requestHttp from 'app-http'
import { CancellationSource } from 'cancellation'
import { createMCPClient } from 'mcp-client'
import { MCPServerService } from 'mcp-server'
import { equal } from 'testing/assert'

const schema = {
  type: 'object',
  properties: { name: { type: 'string', enum: ['Stack-chan', 'World'] } },
  required: ['name'],
}
const server = new MCPServerService({
  port: 0,
  token: 'test-token',
  tools: [
    { name: 'greet', description: 'Greeting', inputSchema: schema, execute: ({ name }) => `Hello ${name}` },
    {
      name: 'fail',
      description: 'Failure',
      inputSchema: { type: 'object', properties: {}, required: [] },
      execute: () => {
        throw new Error('tool failed')
      },
    },
  ],
})
try {
  equal(server.status, 'running')
  const endpoint = `http://127.0.0.1:${server.port}/mcp`
  const source = new CancellationSource()
  for (let cycle = 0; cycle < 20; cycle++) {
    const client = createMCPClient({ url: endpoint, token: 'test-token' }, requestHttp)
    try {
      const tools = await client.connect(source.signal)
      equal(tools.length, 2)
      equal(
        JSON.stringify(tools[0].inputSchema),
        JSON.stringify(schema),
        'SDK schema survives the wire, including enum',
      )
      const result = JSON.parse(await client.call('greet', { name: 'Stack-chan' }, source.signal))
      equal(result.content[0].text, 'Hello Stack-chan')
      equal(JSON.parse(await client.call('fail', {}, source.signal)).isError, true)
    } finally {
      await client.close()
    }
  }
  const unauthorized = createMCPClient({ url: endpoint, token: 'wrong' }, requestHttp)
  let error
  try {
    await unauthorized.connect()
  } catch (value) {
    error = value
  }
  equal(error?.code, 'IO')
  await unauthorized.close()
  trace('ok\n')
} finally {
  server.close()
}
