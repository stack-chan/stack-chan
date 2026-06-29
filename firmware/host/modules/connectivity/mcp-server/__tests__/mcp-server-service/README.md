# MCP Server Service Test

Test code for launching an MCP server with Moddable.

## Running (Linux)

```bash
source ~/.local/share/xs-dev-export.sh
npm run test:moddable -- ./host/modules/connectivity/mcp-server/__tests__/mcp-server-service/manifest.test.json
```

## Testing

Once the server is running, you can test it with the following commands:

### 1. Health Check
```bash
curl http://localhost:8080/health
```

### 2. MCP Protocol Initialization
```bash
curl -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"1","method":"initialize","params":{}}'
```

### 3. List Available Tools
```bash
curl -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"2","method":"tools/list","params":{}}'
```

### 4. Execute Tool (Hello World)
```bash
curl -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"3","method":"tools/call","params":{"name":"hello_world","arguments":{"name":"Stack-chan"}}}'
```

### 5. Execute Tool (Numeric Calculation)
```bash
curl -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"4","method":"tools/call","params":{"name":"add_numbers","arguments":{"a":10,"b":20}}}'
```

## Implemented Tools

- **hello_world**: Returns a greeting message
- **add_numbers**: Adds two numbers
- **get_current_time**: Returns the current time
