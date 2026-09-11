import { MCPServerService, type Tool } from 'mcp-server'
import { equal } from 'testing/assert'

const tool: Tool = {
  name: 'greet',
  description: 'Greeting',
  inputSchema: { type: 'object', properties: {}, required: [] },
  execute: () => 'hello',
}
const server = new MCPServerService({ port: 18080, token: 'test-token', tools: [tool] })
try {
  equal(server.status, 'running')
  equal(server.getTools().length, 1)
  server.addTool({ ...tool, name: 'another' })
  equal(server.getTools().length, 2)
  equal(server.removeTool('greet'), true)
  equal(server.getTools()[0].name, 'another')
  trace('ok\n')
} finally {
  server.close()
}
