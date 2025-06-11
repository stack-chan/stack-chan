import config from 'mc/config'
import { ChatGPTDialogue, type Tool } from 'dialogue-chatgpt'
import { MCPClientService } from 'mcp-client'
import Timer from 'timer'

const token = config.token
const mcp = config.mcp

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

function isValidOption(option: unknown): option is { url: string } {
  return (
    typeof option === 'object' &&
    option !== null &&
    'url' in option &&
    typeof option.url === 'string' &&
    option.url.length > 0
  )
}

async function runTest() {
  trace('=== ChatGPT Dialogue with Tools and MCP Test ===\n')

  // Create MCP clients if URL is provided
  const mcpClients: MCPClientService[] = []
  if (mcp != null) {
    for (const [name, option] of Object.entries(mcp)) {
      if (!isValidOption(option)) {
        trace(`MCP client for ${name} is not configured with a valid URL. Skipping.\n`)
        return
      }
      try {
        const mcpClient = new MCPClientService({ url: option.url })
        await mcpClient.initialize()
        mcpClients.push(mcpClient)
        trace(`MCP client ${name} initialized successfully\n`)
      } catch (error) {
        trace(`MCP client ${name} initialization failed: ${error}\n`)
      }
    }
  }

  // Create dialogue with tools and MCP support
  const dialogue = new ChatGPTDialogue({
    apiKey: token,
    tools: testTools,
    mcpClients: mcpClients,
  })
  trace('Dialogue initialized with tools and MCP clients\n')
  Timer.delay(1000)

  try {
    trace('Sending test message for calculator tool...\n')
    const result = await dialogue.post('Use the calculator tool to calculate 3 + 5')
    if (result.success === true) {
      trace(`Response: ${result.value}\n`)
    } else {
      trace(`Error: ${result.reason}\n`)
    }

    trace('\nSending test message for time tool...\n')
    const timeResult = await dialogue.post('Use the get_time tool to get the current time')
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
