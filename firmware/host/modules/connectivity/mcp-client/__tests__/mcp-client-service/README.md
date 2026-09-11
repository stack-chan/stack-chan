# MCP client/server integration test

Runs the real bounded `app-http` client and MCP server over loopback TCP. Twenty connections verify initialization notification, SDK JSON Schema (including enum), tool execution, tool errors, close, and authentication failure. Every failure throws; a printed diagnostic is not a pass. The server selects a free port.

```sh
# From firmware/, with MODDABLE set:
npm run test:moddable -- host/modules/connectivity/mcp-client/__tests__/mcp-client-service
```

The separate app-conversation XS test covers 100 MCP connection lifetimes, session headers, finite SSE responses, deletion, and calls after close. This is not a test of a live cloud provider or physical Wi-Fi.
