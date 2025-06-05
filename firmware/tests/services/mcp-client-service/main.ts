import { MCPClientService } from 'mcp-client'
import { MCPServerService, type Tool } from 'mcp-server'
import Timer from 'timer'

// Test tools for the dummy server
const testTools: Tool[] = [
  {
    name: 'echo',
    description: 'Echoes the input message',
    parameters: [
      {
        name: 'message',
        type: 'string',
        description: 'The message to echo',
        required: true,
      },
    ],
    handler: async (args: Record<string, unknown>) => {
      const message = args.message
      return `Echo: ${message}`
    },
  },
  {
    name: 'add',
    description: 'Adds two numbers',
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

      return `${a} + ${b} = ${a + b}`
    },
  },
  {
    name: 'get_status',
    description: 'Returns server status',
    parameters: [],
    handler: async () => {
      return 'Server is running normally'
    },
  },
]

async function testMCPClient(): Promise<void> {
  trace('=== MCP Client Service Test ===\n')

  // Start dummy MCP server
  trace('Starting dummy MCP server...\n')
  const server = new MCPServerService({
    port: 8081, // Use different port to avoid conflicts
    tools: testTools,
  })

  // Wait a bit for server to start
  await new Promise((resolve) => Timer.set(resolve, 1000))

  try {
    // Create client
    trace('Creating MCP client...\n')
    const client = new MCPClientService({
      baseUrl: 'http://localhost:8081',
      timeout: 10000,
    })

    // Test 1: Initialize client
    trace('Test 1: Initialize client\n')
    try {
      const initResult = await client.initialize()
      trace('✓ Initialize successful\n')
      trace(`  Protocol Version: ${initResult.protocolVersion}\n`)
      trace(`  Server Name: ${initResult.serverInfo.name}\n`)
      trace(`  Server Version: ${initResult.serverInfo.version}\n`)
    } catch (error) {
      trace(`✗ Initialize failed: ${error}\n`)
      return
    }

    // Test 2: List tools
    trace('\nTest 2: List tools\n')
    try {
      const toolsList = await client.listTools()
      trace('✓ List tools successful\n')
      trace(`  Found ${toolsList.tools.length} tools:\n`)
      for (const tool of toolsList.tools) {
        trace(`    - ${tool.name}: ${tool.description}\n`)
      }
    } catch (error) {
      trace(`✗ List tools failed: ${error}\n`)
      return
    }

    // Test 3: Call echo tool
    trace('\nTest 3: Call echo tool\n')
    try {
      const echoResult = await client.callTool('echo', { message: 'Hello Stack-chan!' })
      trace('✓ Echo tool call successful\n')
      trace(`  Result: ${echoResult.content[0].text}\n`)
    } catch (error) {
      trace(`✗ Echo tool call failed: ${error}\n`)
    }

    // Test 4: Call add tool
    trace('\nTest 4: Call add tool\n')
    try {
      const addResult = await client.callTool('add', { a: 42, b: 58 })
      trace('✓ Add tool call successful\n')
      trace(`  Result: ${addResult.content[0].text}\n`)
    } catch (error) {
      trace(`✗ Add tool call failed: ${error}\n`)
    }

    // Test 5: Call get_status tool
    trace('\nTest 5: Call get_status tool\n')
    try {
      const statusResult = await client.callTool('get_status')
      trace('✓ Get status tool call successful\n')
      trace(`  Result: ${statusResult.content[0].text}\n`)
    } catch (error) {
      trace(`✗ Get status tool call failed: ${error}\n`)
    }

    // Test 6: Test error handling - call non-existent tool
    trace('\nTest 6: Error handling - call non-existent tool\n')
    try {
      await client.callTool('non_existent_tool')
      trace('✗ Expected error but call succeeded\n')
    } catch (error) {
      trace(`✓ Expected error caught: ${error}\n`)
    }

    // Test 7: Test initialization check
    trace('\nTest 7: Test initialization check\n')
    client.reset()
    try {
      await client.listTools()
      trace('✗ Expected error but call succeeded\n')
    } catch (error) {
      trace(`✓ Expected error caught (not initialized): ${error}\n`)
    }

    // Test 8: Re-initialize after reset
    trace('\nTest 8: Re-initialize after reset\n')
    try {
      await client.initialize()
      trace('✓ Re-initialize after reset successful\n')

      // Test that tools work again
      const echoResult = await client.callTool('echo', { message: 'Test after reset' })
      trace(`✓ Tool call after reset successful: ${echoResult.content[0].text}\n`)
    } catch (error) {
      trace(`✗ Re-initialize after reset failed: ${error}\n`)
    }
  } catch (error) {
    trace(`Test failed with error: ${error}\n`)
  }

  trace('\n=== Test Complete ===\n')
}

// Start the test
testMCPClient().catch((error) => {
  trace(`Test execution failed: ${error}\n`)
})
