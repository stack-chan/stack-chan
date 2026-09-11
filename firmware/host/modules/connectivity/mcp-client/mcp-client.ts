import { StackchanError } from 'stackchan/errors'
import type { MCPOptions } from 'stackchan/extensions/conversation'
import type { HttpRequest, HttpResponse, Tool } from 'stackchan/extensions/network'
import type { CancellationSignal } from 'stackchan/task'

type Request = (request: HttpRequest, signal?: CancellationSignal) => Promise<HttpResponse>
type ToolSchema = Omit<Tool, 'execute'>
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function responseMessage(body: string, contentType: string, id: number): Record<string, unknown> {
  try {
    const messages: unknown[] = contentType.includes('text/event-stream')
      ? body
          .replace(/\r\n?/g, '\n')
          .split('\n\n')
          .flatMap((event) => {
            const data = event
              .split('\n')
              .filter((line) => line.startsWith('data:'))
              .map((line) => line.slice(5).replace(/^ /, ''))
              .join('\n')
            return data ? [JSON.parse(data)] : []
          })
      : [JSON.parse(body)]
    const message = messages.find((value) => object(value) && value.id === id)
    if (!object(message) || message.jsonrpc !== '2.0' || (!('result' in message) && !('error' in message)))
      throw new Error('Invalid response')
    return message
  } catch {
    throw new StackchanError('IO', 'MCP returned no matching JSON-RPC response')
  }
}

/** Wire protocol only. The app owns all requests through the injected bounded HTTP transport. */
export function createMCPClient(options: MCPOptions, request: Request) {
  if (typeof options?.url !== 'string' || !/^https?:\/\/[^\s#]+$/.test(options.url))
    throw new StackchanError('INVALID_ARGUMENT', 'MCP needs an HTTP or HTTPS endpoint')
  if (options.token !== undefined && (typeof options.token !== 'string' || /[\r\n]/.test(options.token)))
    throw new StackchanError('INVALID_ARGUMENT', 'MCP token must be a single-line string')
  const url = options.url,
    token = options.token
  let nextId = 0,
    session: string | undefined,
    version: string | undefined,
    closed = false
  let closing: Promise<void> | undefined
  const headers = () => ({
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(session ? { 'Mcp-Session-Id': session } : {}),
    ...(version ? { 'MCP-Protocol-Version': version } : {}),
  })
  const check = (signal?: CancellationSignal) => {
    signal?.throwIfCancelled()
    if (closed) throw new StackchanError('CLOSED', 'MCP connection closed')
  }
  const send = async (method: string, params: unknown, signal?: CancellationSignal, notification = false) => {
    check(signal)
    const id = notification ? undefined : ++nextId
    const response = await request(
      { url, method: 'POST', headers: headers(), body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) },
      signal,
    )
    check(signal)
    if (response.status < 200 || response.status >= 300)
      throw new StackchanError('IO', `MCP request failed (HTTP ${response.status})`)
    if (notification) {
      if (response.status !== 202) throw new StackchanError('IO', 'MCP notification was not acknowledged')
      return {}
    }
    if (method === 'initialize') {
      const value = response.headers?.['mcp-session-id']
      if (value !== undefined && !/^[\x21-\x7e]{1,1024}$/.test(value))
        throw new StackchanError('IO', 'MCP returned an invalid session ID')
      session = value
    }
    const message = responseMessage(response.body, response.headers?.['content-type'] ?? '', id as number)
    if (message.error) throw new StackchanError('IO', 'MCP request returned a protocol error')
    if (!object(message.result)) throw new StackchanError('IO', 'MCP returned an invalid result')
    return message.result
  }
  return {
    async connect(signal?: CancellationSignal): Promise<readonly ToolSchema[]> {
      if (nextId) throw new StackchanError('BUSY', 'MCP initialization has already started')
      const info = await send(
        'initialize',
        { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'stack-chan', version: '2.0.0' } },
        signal,
      )
      if (info.protocolVersion !== '2025-06-18' && info.protocolVersion !== '2025-03-26')
        throw new StackchanError('UNSUPPORTED', 'MCP server needs a supported Streamable HTTP protocol version')
      version = info.protocolVersion
      if (!object(info.capabilities) || !object(info.capabilities.tools))
        throw new StackchanError('UNSUPPORTED', 'MCP server does not provide tools')
      await send('notifications/initialized', undefined, signal, true)
      const tools: ToolSchema[] = [],
        names = new Set<string>()
      let cursor: string | undefined
      for (let page = 0; page < 16; page++) {
        const list = await send('tools/list', cursor ? { cursor } : {}, signal)
        if (!Array.isArray(list.tools)) throw new StackchanError('IO', 'MCP returned an invalid tools list')
        for (const tool of list.tools) {
          if (
            !object(tool) ||
            typeof tool.name !== 'string' ||
            !/^[A-Za-z0-9_-]{1,64}$/.test(tool.name) ||
            names.has(tool.name) ||
            !object(tool.inputSchema) ||
            tool.inputSchema.type !== 'object' ||
            tools.length >= 64
          )
            throw new StackchanError('IO', 'MCP tools need unique names, object schemas and at most 64 entries')
          const properties = tool.inputSchema.properties ?? {},
            required = tool.inputSchema.required ?? []
          if (!object(properties) || !Array.isArray(required) || required.some((key) => typeof key !== 'string'))
            throw new StackchanError('IO', 'MCP returned an invalid tool schema')
          names.add(tool.name)
          tools.push({
            name: tool.name,
            description: typeof tool.description === 'string' ? tool.description : tool.name,
            inputSchema: { ...tool.inputSchema, type: 'object', properties, required } as Tool['inputSchema'],
          })
        }
        if (list.nextCursor === undefined) return tools
        if (typeof list.nextCursor !== 'string' || !list.nextCursor || list.nextCursor === cursor)
          throw new StackchanError('IO', 'MCP returned an invalid pagination cursor')
        cursor = list.nextCursor
      }
      throw new StackchanError('IO', 'MCP tool listing exceeded 16 pages')
    },
    async call(name: string, args: Record<string, unknown>, signal?: CancellationSignal): Promise<string> {
      if (!version) throw new StackchanError('CONFIG', 'MCP is not initialized')
      const result = await send('tools/call', { name, arguments: args }, signal)
      if (!Array.isArray(result.content)) throw new StackchanError('IO', 'MCP returned an invalid tool result')
      // Preserve isError, non-text content and structuredContent for the model as well as text.
      const text = JSON.stringify(result)
      if (text.length > 16384) throw new StackchanError('IO', 'MCP tool result exceeds 16384 characters')
      return text
    },
    close(): Promise<void> {
      if (closing) return closing
      closed = true
      const closingHeaders = headers(),
        hadSession = !!session
      session = undefined
      version = undefined
      closing = (async () => {
        if (!hadSession) return
        const response = await request({ url, method: 'DELETE', headers: closingHeaders, timeoutMs: 5000 })
        if ((response.status < 200 || response.status >= 300) && response.status !== 404 && response.status !== 405)
          throw new StackchanError('IO', `MCP session release failed (HTTP ${response.status})`)
      })()
      return closing
    },
  }
}
