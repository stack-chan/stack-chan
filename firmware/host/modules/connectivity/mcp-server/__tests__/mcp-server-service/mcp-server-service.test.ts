import { MCPServerService, type Tool } from 'mcp-server'

// Example tool: Hello World
const helloWorldTool: Tool = {
  name: 'hello_world',
  description: 'Returns a greeting message',
  parameters: [
    {
      name: 'name',
      type: 'string',
      description: 'The name to greet',
      required: false,
    },
  ],
  handler: async (args: Record<string, unknown>) => {
    const name = args.name || 'World'
    return `Hello, ${name}!`
  },
}

// Example tool: Add Numbers
const addNumbersTool: Tool = {
  name: 'add_numbers',
  description: 'Adds two numbers together',
  parameters: [
    {
      name: 'a',
      type: 'number',
      description: 'First number',
      required: true,
    },
    {
      name: 'b',
      type: 'number',
      description: 'Second number',
      required: true,
    },
  ],
  handler: async (args: Record<string, unknown>) => {
    const a = Number(args.a)
    const b = Number(args.b)

    if (Number.isNaN(a) || Number.isNaN(b)) {
      throw new Error('Both arguments must be valid numbers')
    }

    const result = a + b
    return `The sum of ${a} and ${b} is ${result}`
  },
}

// Example tool: Get Current Time
const getCurrentTimeTool: Tool = {
  name: 'get_current_time',
  description: 'Returns the current system time',
  parameters: [],
  handler: async () => {
    const now = new Date()
    return `Current time: ${now.toISOString()}`
  },
}

// Start MCP Server
trace('Starting MCP Server Test...\n')

const server = new MCPServerService({
  port: 8080,
  token: 'test-token',
  tools: [helloWorldTool, addNumbersTool, getCurrentTimeTool],
})

trace('MCP Server started with tools:\n')
for (const tool of server.getTools()) {
  trace(`  - ${tool.name}: ${tool.description}\n`)
}

trace('Server is running on http://localhost:8080\n')
trace('Health check endpoint: GET http://localhost:8080/health\n')
trace('MCP endpoint: POST http://localhost:8080/mcp\n')
trace('\nExample requests:\n')
trace('1. Initialize:\n')
trace('   POST /mcp\n')
trace('   Authorization: Bearer test-token\n')
trace('   {"jsonrpc":"2.0","id":"1","method":"initialize","params":{}}\n\n')
trace('2. List tools:\n')
trace('   POST /mcp\n')
trace('   Authorization: Bearer test-token\n')
trace('   {"jsonrpc":"2.0","id":"2","method":"tools/list","params":{}}\n\n')
trace('3. Call tool:\n')
trace('   POST /mcp\n')
trace('   Authorization: Bearer test-token\n')
trace(
  '   {"jsonrpc":"2.0","id":"3","method":"tools/call","params":{"name":"hello_world","arguments":{"name":"Stack-chan"}}}\n\n',
)
trace('ok\n')
