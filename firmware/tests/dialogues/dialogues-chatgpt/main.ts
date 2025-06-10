import config from 'mc/config'
import { ChatGPTDialogue, type Tool } from 'dialogue-chatgpt'
import { MCPClientService } from 'mcp-client'
import Timer from 'timer'

const token = config.token
const mcpServerUrl = config.mcpServerUrl

// Test tools for local execution
const testTools: Tool[] = [
  {
    name: 'get_time',
    description: 'Get current time',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
    execute: async () => {
      return `Current time: ${new Date().toISOString()}`
    },
  },
  {
    name: 'calculator',
    description: 'Simple calculator',
    inputSchema: {
      type: 'object' as const,
      properties: {
        operation: {
          type: 'string',
          description: 'Operation: add, subtract, multiply, divide',
        },
        a: {
          type: 'number',
          description: 'First number',
        },
        b: {
          type: 'number',
          description: 'Second number',
        },
      },
      required: ['operation', 'a', 'b'],
    },
    execute: async (args: Record<string, unknown>) => {
      const { operation, a, b } = args
      const numA = Number(a)
      const numB = Number(b)

      switch (operation) {
        case 'add':
          return `${numA} + ${numB} = ${numA + numB}`
        case 'subtract':
          return `${numA} - ${numB} = ${numA - numB}`
        case 'multiply':
          return `${numA} * ${numB} = ${numA * numB}`
        case 'divide':
          return `${numA} / ${numB} = ${numA / numB}`
        default:
          throw new Error('Invalid operation')
      }
    },
  },
]

async function runTest() {
  trace('=== ChatGPT Dialogue with Tools and MCP Test ===\n')

  // Create MCP clients if URL is provided
  const mcpClients: MCPClientService[] = []
  if (mcpServerUrl) {
    try {
      const mcpClient = new MCPClientService({ url: mcpServerUrl })
      await mcpClient.initialize()
      mcpClients.push(mcpClient)
      trace('MCP client initialized successfully\n')
    } catch (error) {
      trace(`MCP client initialization failed: ${error}\n`)
    }
  }

  if (!token || token === 'YOUR_API_KEY_HERE') {
    trace('API token is missing. Testing tools integration structure only.\n')

    // Test dialogue creation with tools and MCP clients
    const dialogue = new ChatGPTDialogue({
      apiKey: 'dummy-key',
      tools: testTools,
      mcpClients: mcpClients,
    })

    trace('✓ Dialogue with tools and MCP clients created successfully\n')
    trace('Note: Actual API calls require valid OpenAI API key\n')
    return
  }

  // Create dialogue with tools and MCP support
  const dialogue = new ChatGPTDialogue({
    apiKey: token,
    tools: testTools,
    mcpClients: mcpClients,
  })

  // Wait for initialization
  await new Promise((resolve) => Timer.set(resolve, 1000))
  trace('Dialogue initialized with tools and MCP clients\n')

  try {
    trace('Sending test message for calculator tool...\n')
    const result = await dialogue.post('calculatorツールを使って３＋５を計算してください')
    if (result.success === true) {
      trace(`Response: ${result.value}\n`)
    } else {
      trace(`Error: ${result.reason}\n`)
    }

    trace('\nSending test message for time tool...\n')
    const timeResult = await dialogue.post('get_timeツールを使って現在時刻を教えてください')
    if (timeResult.success === true) {
      trace(`Response: ${timeResult.value}\n`)
    } else {
      trace(`Error: ${timeResult.reason}\n`)
    }
  } catch (error) {
    trace(`An error occurred: ${error.message}\n`)
  }

  trace('=== Test Complete ===\n')
}

runTest().catch((error) => {
  trace(`Test execution failed: ${error}\n`)
})
