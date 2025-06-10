import { fetch } from 'fetch'

/**
 * Minimal fetch Response interface for Moddable
 */
interface FetchResponse {
  ok: boolean
  status: number
  statusText: string
  headers: {
    get(name: string): string | null
  }
  text(): Promise<string>
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
 * MCP Client configuration
 */
export interface MCPClientConfig {
  url: string
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
    description?: string
    inputSchema: {
      type: 'object'
      properties: Record<
        string,
        {
          type: string
          description?: string
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
  #url: string
  #timeout: number
  #requestId = 0
  #initialized = false
  #sessionId?: string

  constructor(config: MCPClientConfig) {
    this.#url = config.url.endsWith('/') ? config.url.slice(0, -1) : config.url
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
    this.#sessionId = undefined
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

    const url = this.#url

    // Build headers according to MCP spec
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      // Client MUST accept both application/json and text/event-stream
      Accept: 'application/json, text/event-stream',
    }

    // Include session ID for all requests after initialization
    if (this.#sessionId && method !== 'initialize') {
      headers['Mcp-Session-Id'] = this.#sessionId
    }

    try {
      const response = (await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
      })) as FetchResponse

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status} ${response.statusText}`)
      }

      // Extract session ID from initialization response
      if (method === 'initialize') {
        const sessionId = response.headers.get('mcp-session-id')
        if (sessionId) {
          this.#sessionId = sessionId
        }
      }

      const contentType = response.headers.get('content-type')

      if (contentType?.includes('text/event-stream')) {
        // Handle SSE response
        return await this.#handleSSEResponse(response, id)
      }

      // Handle JSON response
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
   * Handle Server-Sent Events response
   */
  async #handleSSEResponse(response: FetchResponse, requestId: number): Promise<MCPResponse> {
    // For now, fall back to text parsing since SSE is complex to implement
    // in the Moddable environment without proper streaming support
    const responseText = await response.text()

    // Parse SSE format manually
    const lines = responseText.split('\n')
    let mcpResponse: MCPResponse | null = null

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6)
        if (data === '[DONE]') {
          break
        }

        try {
          const parsed: MCPResponse = JSON.parse(data)

          // Check if this is the response for our request
          if (parsed.id === requestId) {
            mcpResponse = parsed
            break
          }
        } catch {
          // Ignore malformed JSON in SSE data
        }
      }
    }

    if (!mcpResponse) {
      throw new Error('No matching response received in SSE stream')
    }

    // Validate response
    if (mcpResponse.jsonrpc !== '2.0') {
      throw new Error('Invalid JSON-RPC response')
    }

    return mcpResponse
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
