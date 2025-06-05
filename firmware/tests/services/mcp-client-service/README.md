# MCP Client Service Test

This test demonstrates the MCP (Model Context Protocol) client service by:

1. Starting a dummy MCP server with test tools
2. Creating an MCP client to connect to the server
3. Testing various client operations:
   - Initialize connection
   - List available tools
   - Call tools with different parameters
   - Error handling for invalid requests
   - Reset and re-initialization

## Test Tools

The dummy server provides these test tools:

- **echo**: Echoes the input message
- **add**: Adds two numbers together
- **get_status**: Returns server status

## Running the Test

```bash
npm run build
# Flash the test to a device
```

## Expected Output

The test will show:
- Successful initialization with server info
- List of available tools
- Results from tool calls
- Proper error handling for invalid requests
- Reset and re-initialization functionality