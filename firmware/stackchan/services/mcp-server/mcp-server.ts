import Headers from 'headers'
import listen, { Response } from 'listen'

/**
 * MCP Tool parameter definition
 */
export interface ToolParameter {
  name: string
  type: 'string' | 'number' | 'boolean' | 'object'
  description: string
  required?: boolean
}

/**
 * MCP Tool definition
 */
export interface Tool {
  name: string
  description: string
  parameters: ToolParameter[]
  handler: (args: Record<string, unknown>) => Promise<string> | string
}

/**
 * MCP Server configuration
 */
export interface MCPServerConfig {
  port?: number
  tools?: Tool[]
}

/**
 * HTTP Connection interface
 */
interface HTTPConnection {
  request: HTTPRequest
  respondWith: (response: Response) => void
}

/**
 * HTTP Request interface
 */
interface HTTPRequest {
  method?: string
  url?: {
    pathname?: string
  }
  text: () => Promise<string>
}

/**
 * Initialize response
 */
interface InitializeResult {
  protocolVersion: string
  capabilities: {
    tools: Record<string, unknown>
  }
  serverInfo: {
    name: string
    version: string
  }
}

/**
 * Tools list response
 */
interface ToolsListResult {
  tools: {
    name: string
    description: string
    inputSchema: {
      type: 'object'
      properties: Record<
        string,
        {
          type: string
          description: string
        }
      >
      required: string[]
    }
  }[]
}

/**
 * Tools call request parameters
 */
interface ToolsCallParams {
  name: string
  arguments?: Record<string, unknown>
}

/**
 * Tools call response
 */
interface ToolsCallResult {
  content: {
    type: 'text'
    text: string
  }[]
}

/**
 * MCP Protocol message types
 */
interface MCPMessage {
  jsonrpc: '2.0'
  id?: string | number | null
  method?: string
  params?: unknown
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

interface MCPRequest extends MCPMessage {
  method: string
  params?: unknown
}

interface MCPResponse extends MCPMessage {
  id: string | number | null
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

/**
 * MCP Server Service for Moddable
 * Implements Model Context Protocol over Streamable HTTP Transport
 */
export class MCPServerService {
  #tools: Map<string, Tool> = new Map()
  #port: number

  constructor(config: MCPServerConfig = {}) {
    this.#port = config.port ?? 8080

    // Register provided tools
    if (config.tools) {
      for (const tool of config.tools) {
        this.#tools.set(tool.name, tool)
      }
    }

    this.#startServer()
  }

  /**
   * Add a tool to the server
   */
  addTool(tool: Tool): void {
    this.#tools.set(tool.name, tool)
  }

  /**
   * Remove a tool from the server
   */
  removeTool(name: string): boolean {
    return this.#tools.delete(name)
  }

  /**
   * Get list of available tools
   */
  getTools(): Tool[] {
    return Array.from(this.#tools.values())
  }

  /**
   * Start the HTTP server
   */
  async #startServer(): Promise<void> {
    trace(`MCP Server starting on port ${this.#port}\n`)

    try {
      for await (const connection of listen({ port: this.#port })) {
        this.#handleConnection(connection)
      }
    } catch (error) {
      trace(`Failed to start MCP server: ${error}\n`)
    }
  }

  /**
   * Handle incoming HTTP connection
   */
  async #handleConnection(connection: HTTPConnection): Promise<void> {
    const request = connection.request
    const method = request.method?.toUpperCase()
    const pathname = request.url?.pathname

    try {
      let response: Response

      if (method === 'POST' && pathname === '/mcp') {
        response = await this.#handleMCPMessage(request)
      } else if (method === 'GET' && pathname === '/health') {
        response = this.#createResponse(200, { status: 'ok' })
      } else {
        response = this.#createResponse(404, { error: 'Not Found' })
      }

      connection.respondWith(response)
    } catch (error) {
      trace(`Error handling connection: ${error}\n`)
      const errorResponse = this.#createResponse(500, { error: 'Internal Server Error' })
      connection.respondWith(errorResponse)
    }
  }

  /**
   * Handle MCP protocol message
   */
  async #handleMCPMessage(request: HTTPRequest): Promise<Response> {
    try {
      const body = await request.text()
      const message: MCPRequest = JSON.parse(body)

      // Validate JSON-RPC format
      if (message.jsonrpc !== '2.0') {
        return this.#createMCPErrorResponse(message.id ?? null, -32600, 'Invalid Request')
      }

      let result: InitializeResult | ToolsListResult | ToolsCallResult

      switch (message.method) {
        case 'initialize':
          result = await this.#handleInitialize(message.params)
          break
        case 'tools/list':
          result = await this.#handleToolsList()
          break
        case 'tools/call':
          result = await this.#handleToolsCall(message.params)
          break
        default:
          return this.#createMCPErrorResponse(message.id ?? null, -32601, 'Method not found')
      }

      return this.#createMCPSuccessResponse(message.id ?? null, result)
    } catch (error) {
      trace(`Error parsing MCP message: ${error}\n`)
      return this.#createMCPErrorResponse(null, -32700, 'Parse error')
    }
  }

  /**
   * Handle initialize request
   */
  async #handleInitialize(_params: unknown): Promise<InitializeResult> {
    return {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: 'stack-chan-mcp-server',
        version: '1.0.0',
      },
    }
  }

  /**
   * Handle tools/list request
   */
  async #handleToolsList(): Promise<ToolsListResult> {
    const tools = Array.from(this.#tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: {
        type: 'object' as const,
        properties: tool.parameters.reduce(
          (props, param) => {
            props[param.name] = {
              type: param.type,
              description: param.description,
            }
            return props
          },
          {} as Record<
            string,
            {
              type: string
              description: string
            }
          >,
        ),
        required: tool.parameters.filter((param) => param.required).map((param) => param.name),
      },
    }))

    return { tools }
  }

  /**
   * Handle tools/call request
   */
  async #handleToolsCall(params: unknown): Promise<ToolsCallResult> {
    if (!params || typeof params !== 'object') {
      throw new Error('Invalid parameters')
    }

    const toolsCallParams = params as ToolsCallParams
    const { name, arguments: args } = toolsCallParams

    if (!name || typeof name !== 'string') {
      throw new Error('Tool name is required')
    }

    const tool = this.#tools.get(name)
    if (!tool) {
      throw new Error(`Tool '${name}' not found`)
    }

    try {
      const result = await tool.handler(args || {})
      return {
        content: [
          {
            type: 'text',
            text: result,
          },
        ],
      }
    } catch (error) {
      throw new Error(`Tool execution failed: ${error}`)
    }
  }

  /**
   * Create HTTP response
   */
  #createResponse(status: number, data: unknown): Response {
    const body = JSON.stringify(data)
    const headers = new Headers()
    headers.set('Content-Type', 'application/json')
    headers.set('Access-Control-Allow-Origin', '*')
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    headers.set('Access-Control-Allow-Headers', 'Content-Type')

    return new Response(body, {
      status,
      headers,
    })
  }

  /**
   * Create MCP success response
   */
  #createMCPSuccessResponse(id: string | number | null, result: unknown): Response {
    const response: MCPResponse = {
      jsonrpc: '2.0',
      id,
      result,
    }
    return this.#createResponse(200, response)
  }

  /**
   * Create MCP error response
   */
  #createMCPErrorResponse(id: string | number | null, code: number, message: string, data?: unknown): Response {
    const response: MCPResponse = {
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message,
        data,
      },
    }
    return this.#createResponse(200, response)
  }
}

export default MCPServerService
