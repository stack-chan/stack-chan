import Headers from 'headers'
import { HttpServerService, Response } from 'http-server-service'
import { authorizeMCPRequest, normalizeMCPToken } from 'mcp-auth'
import { StackchanError } from 'stackchan/errors'
import type { Tool as AppTool } from 'stackchan/extensions/network'

/** The caller supplies the app-owned execute function; JSON Schema is shared with the SDK. */
export type Tool = Omit<AppTool, 'execute'> & { execute(input: Record<string, unknown>): string | Promise<string> }
export type MCPServerConfig = { port?: number; tools?: readonly Tool[]; token?: string }
export type MCPServerStatus = 'starting' | 'running' | 'failed'
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function response(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), { status, headers: new Headers([['Content-Type', 'application/json']]) })
}

/** Stateless MCP Streamable HTTP endpoint; the HTTP service owns sockets and request limits. */
export class MCPServerService {
  #server?: HttpServerService
  #tools = new Map<string, Tool>()
  #token?: string
  #status: MCPServerStatus = 'starting'
  #error?: string
  constructor(config: MCPServerConfig = {}) {
    this.#token = normalizeMCPToken(config.token)
    for (const tool of config.tools ?? []) this.addTool(tool)
    try {
      const server = new HttpServerService({ port: config.port ?? 8080 })
      this.#server = server
      server.get('/health', () => response(200, { status: 'ok' }))
      server.post('/mcp', async (context) => {
        if (!authorizeMCPRequest(context.req.header('authorization'), this.#token).authorized)
          return response(401, { error: 'Unauthorized' })
        return this.#handle((await context.req.text()) ?? '')
      })
      this.#status = 'running'
    } catch (error) {
      this.#status = 'failed'
      this.#error = error instanceof Error ? error.message : 'MCP listener failed'
      this.#server?.close()
    }
  }
  get port(): number | undefined {
    return this.#server?.port
  }
  get status(): MCPServerStatus {
    return this.#status
  }
  get error(): string | undefined {
    return this.#error
  }
  close(): void {
    this.#server?.close()
  }
  addTool(tool: Tool): void {
    if (
      !tool ||
      typeof tool.name !== 'string' ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(tool.name) ||
      typeof tool.execute !== 'function' ||
      !object(tool.inputSchema) ||
      tool.inputSchema.type !== 'object'
    )
      throw new StackchanError('INVALID_ARGUMENT', 'MCP tools need a name, object schema and execute function')
    this.#tools.set(tool.name, { ...tool, inputSchema: JSON.parse(JSON.stringify(tool.inputSchema)) })
  }
  removeTool(name: string): boolean {
    return this.#tools.delete(name)
  }
  getTools(): Tool[] {
    return Array.from(this.#tools.values())
  }
  async #handle(body: string): Promise<Response> {
    let id: string | number | null = null
    const error = (code: number, message: string) => response(200, { jsonrpc: '2.0', id, error: { code, message } })
    let message: unknown
    try {
      message = JSON.parse(body)
    } catch {
      return error(-32700, 'Parse error')
    }
    if (
      !object(message) ||
      message.jsonrpc !== '2.0' ||
      typeof message.method !== 'string' ||
      (message.id !== undefined && typeof message.id !== 'string' && typeof message.id !== 'number')
    )
      return error(-32600, 'Invalid Request')
    id = (message.id as string | number | undefined) ?? null
    if (message.method === 'notifications/initialized')
      return message.id === undefined ? new Response('', { status: 202 }) : error(-32600, 'Invalid notification')
    if (message.id === undefined) return error(-32600, 'Request ID required')
    let result: unknown
    switch (message.method) {
      case 'initialize':
        result = {
          protocolVersion: '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'stack-chan', version: '2.0.0' },
        }
        break
      case 'tools/list':
        result = {
          tools: this.getTools().map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
        }
        break
      case 'tools/call': {
        const params = message.params
        if (
          !object(params) ||
          typeof params.name !== 'string' ||
          (params.arguments !== undefined && !object(params.arguments))
        )
          return error(-32602, 'Tool name and object arguments required')
        const tool = this.#tools.get(params.name)
        if (!tool) return error(-32602, 'Unknown tool')
        try {
          const text = await tool.execute((params.arguments as Record<string, unknown>) ?? {})
          if (typeof text !== 'string' || text.length > 16384) throw new Error('Tool result exceeds 16384 characters')
          result = { content: [{ type: 'text', text }] }
        } catch (failure) {
          result = {
            isError: true,
            content: [{ type: 'text', text: failure instanceof Error ? failure.message : 'Tool failed' }],
          }
        }
        break
      }
      default:
        return error(-32601, 'Method not found')
    }
    return response(200, { jsonrpc: '2.0', id, result })
  }
}
