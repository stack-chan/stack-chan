# MCP server

Applications use `network(app).serveTools({ port, tools })` from `stackchan/extensions/network`. The host supplies the server and owns its listener, requests and tool tasks. Configure `mcp.token` through Settings; unauthenticated `POST /mcp` requests are rejected.

The SDK `Tool` schema is sent unchanged by `tools/list`, including enum and required fields. `tools/call` returns a text content block; an execute failure uses `isError: true`. The server implements stateless Streamable HTTP (`2025-06-18`), initialization notification, and `GET /health`. Raw server construction is an internal host/test interface.

See the runnable [MCP example](../../../../mods/examples/mcp/README_ja.md), [provider/MCP migration](../../../../mods/examples/provider-dialogues/README_ja.md), and the [loopback integration test](../mcp-client/__tests__/mcp-client-service/README.md).
