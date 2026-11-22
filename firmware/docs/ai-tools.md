# Tool execution and MCP adapters

`ToolSet.create(tools, { maxOutputChars })` validates arguments before calling a tool. The built-in schema validator supports types, enums, constants, object properties and required fields, additional properties, array items, and numeric minimum/maximum. Schemas using other validation keywords require a `validate(input)` function that checks those constraints. Unsupported schemas fail registration rather than silently disabling validation.

For MCP discovery, supply validators by tool name:

```ts
import { ToolSet, toolsFromMCP } from 'stackchan/ai'

const tools = ToolSet.create(await toolsFromMCP(client, {
  validators: {
    lookupEmail: input => typeof input.email === 'string' && isValidEmail(input.email),
  },
}))
```

`isValidEmail` is the application's validator. It must implement the actual constraints advertised by that tool. `format`, `oneOf`, and other unsupported keywords are not accepted without a validator. If one is missing, `toolsFromMCP()` rejects with `unsupported_capability` and the tool name, before returning an unusable collection. Validators are optional for tools whose schemas fit the built-in subset.

## Cancellation

Tool handlers receive `context.signal`. When it is aborted, ToolSet rejects an outstanding asynchronous wait with `cancelled_unconfirmed`, detaches its listener, and consumes a late rejection. It refuses further tool execution until that abandoned promise actually settles. The Agent preserves this error code with `status: 'cancelled'`, so a conversation can require restart instead of assuming all work stopped. Synchronous results already returned by a tool remain available to the Agent's history. Cancellation cannot interrupt synchronous JavaScript.

The MCP adapter forwards `{ signal }` as the optional third `client.callTool(name, input, scope)` argument. An adapter for a client with cancellation support must connect that signal to its transport's cancellation API. The bundled `MCPClientService` currently has no such API: cancellation stops waiting locally, while its HTTP request and remote effects may continue. Do not retry an irreversible action merely because its wait was cancelled. The Agent records an unknown effect when cancellation wins before a result is known.

## Result budgets

String tool results are returned as text. Other results are serialized with ordinary JSON rules: dates and `toJSON()` conversions, omitted undefined object properties, null array holes, and non-finite numbers are supported. Repeated references are allowed; cycles and BigInt values are rejected. Return plain data without accessors that mutate the object during serialization.

`maxOutputChars` defaults to 4096 UTF-16 code units. JSON escaping counts toward that budget. Serialization checks strings before escaping and writes only within the output budget; it does not clone the whole result tree or build an oversized JSON string first. It also limits nesting to 40 levels and visited values to `maxOutputChars`, so a huge object of omitted values cannot consume unbounded traversal work. Budget overflow reports `resource_exhausted`; cyclic or non-serializable results report `tool_failed`.

These limits cover ToolSet's serialization, not memory already allocated by a tool, getter, or `toJSON()` implementation. Tool authors must also bound their own computation and result construction.
