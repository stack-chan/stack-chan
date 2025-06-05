import { fetch } from 'fetch'

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
 * MCP Client configuration
 */
export interface MCPClientConfig {
  baseUrl: string
  timeout?: number
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
 * Tools call response
 */
interface ToolsCallResult {
  content: {
    type: 'text'
    text: string
  }[]
}

/**
 * MCP Client Service for Moddable
 * Implements Model Context Protocol client over HTTP
 */
export class MCPClientService {
  #baseUrl: string
  #timeout: number
  #requestId = 0
  #initialized = false

  constructor(config: MCPClientConfig) {
    this.#baseUrl = config.baseUrl.endsWith('/') ? config.baseUrl.slice(0, -1) : config.baseUrl
    this.#timeout = config.timeout ?? 30000
  }

  /**
   * Initialize connection with MCP server
   */
  async initialize(): Promise<InitializeResult> {
    if (this.#initialized) {
      throw new Error('Client is already initialized')
    }

    const response = await this.#sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
      },
      clientInfo: {
        name: 'stack-chan-mcp-client',
        version: '1.0.0',
      },
    })

    if (response.error) {
      throw new Error(`Initialize failed: ${response.error.message}`)
    }

    this.#initialized = true
    return response.result as InitializeResult
  }

  /**
   * List available tools from the server
   */
  async listTools(): Promise<ToolsListResult> {
    this.#ensureInitialized()

    const response = await this.#sendRequest('tools/list', {})

    if (response.error) {
      throw new Error(`List tools failed: ${response.error.message}`)
    }

    return response.result as ToolsListResult
  }

  /**
   * Call a tool on the server
   */
  async callTool(name: string, arguments_?: Record<string, unknown>): Promise<ToolsCallResult> {
    this.#ensureInitialized()

    const response = await this.#sendRequest('tools/call', {
      name,
      arguments: arguments_ || {},
    })

    if (response.error) {
      throw new Error(`Tool call failed: ${response.error.message}`)
    }

    return response.result as ToolsCallResult
  }

  /**
   * Check if client is initialized
   */
  isInitialized(): boolean {
    return this.#initialized
  }

  /**
   * Reset client state
   */
  reset(): void {
    this.#initialized = false
    this.#requestId = 0
  }

  /**
   * Send HTTP request to MCP server
   */
  async #sendRequest(method: string, params: unknown): Promise<MCPResponse> {
    const id = this.#generateRequestId()

    const request: MCPRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    }

    const url = `${this.#baseUrl}/mcp`

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      })

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status} ${response.statusText}`)
      }

      const responseText = await response.text()
      const mcpResponse: MCPResponse = JSON.parse(responseText)

      // Validate response
      if (mcpResponse.jsonrpc !== '2.0') {
        throw new Error('Invalid JSON-RPC response')
      }

      if (mcpResponse.id !== id) {
        throw new Error('Response ID mismatch')
      }

      return mcpResponse
    } catch (error) {
      throw new Error(`Request failed: ${error}`)
    }
  }

  /**
   * Generate unique request ID
   */
  #generateRequestId(): number {
    return ++this.#requestId
  }

  /**
   * Ensure client is initialized
   */
  #ensureInitialized(): void {
    if (!this.#initialized) {
      throw new Error('Client not initialized. Call initialize() first.')
    }
  }
}

export default MCPClientService
