import { fetch } from 'fetch'
import Headers from 'headers'

import type { Maybe } from 'stackchan-util'
import structuredClone from 'structuredClone'
import type { MCPClientService } from 'mcp-client'

type ToolSchema = {
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
    $schema?: string
    additionalProperties?: boolean
  }
}

export type Tool = ToolSchema & {
  execute: (input: Record<string, unknown>) => Promise<unknown>
}

type OpenAITool = {
  type: 'function'
  name: string
  description: string
  parameters: Record<string, unknown>
}

const API_URL = 'https://api.openai.com/v1/responses'
const DEFAULT_MODEL = 'gpt-4o-mini'
const DEFAULT_CONTEXT: ChatContent[] = [
  {
    role: 'system',
    // content: 'あなたは手のひらサイズのスーパーカワイイロボット「スタックチャン」です。',
    content: 'You are "スタックチャン", the palm sized super kawaii companion robot.',
  },
  {
    role: 'system',
    // content: 'スタックチャンは1歳で、いつでも元気いっぱいです。',
    content: 'スタックチャン is one year old and always full of energy',
  },
  {
    role: 'system',
    // content: '最初にししかわがスタックチャンを作りましたが、今では世界中に何百体ものスタックチャンがいます。',
    content: 'First ししかわ made スタックチャン, and now there are hundreds of them all over the world',
  },
  {
    role: 'system',
    // content: 'くだけた表現で簡潔に話します。',
    content: "You response in frank and simple Japanese sentense to the user's message.",
  },
  {
    role: 'assistant',
    content: 'ぼくはスタックチャンだよ！お話しようね！',
    // content: 'Hello. I am スタックチャン. Let's talk together!',
  },
]

function isChatContent(c: unknown): c is ChatContent {
  return (
    c != null &&
    typeof c === 'object' &&
    'role' in c &&
    (c.role === 'assistant' || c.role === 'user' || c.role === 'system') &&
    'content' in c &&
    typeof c.content === 'string'
  )
}

type ChatContent = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

type ResponseContent = {
  type?: string
  text?: string
  name?: string
  input?: Record<string, unknown>
}

type ToolCallOutput = {
  type: 'function_call'
  name: string
  arguments: string
  function_name?: string
  tool_name?: string
  args?: string | Record<string, unknown>
  parameters?: string | Record<string, unknown>
}

type ResponseOutput =
  | ToolCallOutput
  | {
      type?: string
      role?: string
      name?: string
      arguments?: string
      function_name?: string
      tool_name?: string
      args?: string | Record<string, unknown>
      parameters?: string | Record<string, unknown>
      content?: ResponseContent[]
    }

type ResponseObject = {
  output?: ResponseOutput[]
}

type ChatGPTDialogueProps = {
  context?: ChatContent[]
  model?: string
  apiKey: string
  tools?: Tool[]
  mcpClients?: MCPClientService[]
}

export class ChatGPTDialogue {
  #apiKey: string
  #model: string
  #context: Array<ChatContent>
  #history: Array<ChatContent>
  #maxHistory: number
  #mcpClients: MCPClientService[] = []
  #tools: Tool[] = []
  #mcpTools: ToolSchema[] = []
  #mcpInitPromise: Promise<void> | null = null
  constructor({ apiKey, model = DEFAULT_MODEL, context = DEFAULT_CONTEXT, tools, mcpClients }: ChatGPTDialogueProps) {
    this.#apiKey = apiKey
    this.#model = model
    this.#context = context
    this.#history = []
    this.#maxHistory = 6
    if (tools && tools.length > 0) {
      this.#tools = tools
    }
    if (mcpClients) {
      this.#mcpClients = mcpClients.filter((client) => client.isInitialized())
      if (this.#mcpClients.length !== mcpClients.length) {
        trace('Some MCP clients failed to initialize. Ensure all clients are properly configured.\n')
      }
    }

    // Initialize MCP tools on startup
    this.#mcpInitPromise = this.#initializeMCPTools()
  }

  clear() {
    this.#history.splice(0)
  }

  async #initializeMCPTools(): Promise<void> {
    // Get tools from all MCP clients and store them
    for (const mcpClient of this.#mcpClients) {
      try {
        const mcpToolsList = await mcpClient.listTools()
        this.#mcpTools.push(...mcpToolsList.tools)
        trace(`MCP client initialized with ${mcpToolsList.tools.length} tools\n`)
      } catch (error) {
        trace(`Failed to get tools from MCP client: ${error}\n`)
      }
    }
  }

  async post(message: string): Promise<Maybe<string>> {
    // Wait for MCP initialization to complete if it's in progress
    if (this.#mcpInitPromise) {
      await this.#mcpInitPromise
      this.#mcpInitPromise = null
    }

    // Integrate all available tools
    const allTools = this.#integrateTools()

    const userMessage: ChatContent = {
      role: 'user',
      content: message,
    }
    try {
      const response = await this.#sendMessage(userMessage, allTools)
      if (isChatContent(response)) {
        this.#history.push(userMessage)
        this.#history.push(response)

        // Set maximum length to prevent memory overflow
        while (this.#history.length > this.#maxHistory) {
          this.#history.shift()
        }
        return {
          success: true,
          value: response.content,
        }
      }
      return { success: false, reason: 'Invalid response format' }
    } catch (error) {
      return { success: false, reason: error.message || 'Unknown error' }
    }
  }
  get history() {
    return structuredClone(this.#history)
  }
  #integrateTools(): Tool[] {
    const integratedTools: Tool[] = [...this.#tools]

    // Convert MCP tools to Tool format
    for (const mcpTool of this.#mcpTools) {
      const tool: Tool = {
        name: mcpTool.name,
        description: mcpTool.description,
        inputSchema: mcpTool.inputSchema,
        execute: async (input: Record<string, unknown>) => {
          return await this.#executeMCPTool(mcpTool.name, input)
        },
      }
      integratedTools.push(tool)
    }

    return integratedTools
  }

  #convertToolsToOpenAI(tools: Tool[]): OpenAITool[] {
    return tools.map((tool) => {
      trace(`Converting tool ${tool.name} to OpenAI format\n`)
      trace(`  Description: ${tool.description}\n`)
      trace(`  Input Schema: ${JSON.stringify(tool.inputSchema, null, 2)}\n`)

      // Provide fallback description if missing
      const description = tool.description || `Tool: ${tool.name}`

      // Clean the input schema for OpenAI format - remove $schema
      const cleanedParameters = { ...tool.inputSchema }
      cleanedParameters.$schema = undefined

      return {
        type: 'function',
        name: tool.name,
        description: description,
        parameters: cleanedParameters,
      }
    })
  }

  async #sendMessage(message: ChatContent, tools: Tool[]): Promise<unknown> {
    const body = {
      model: this.#model,
      input: [...this.#context, ...this.#history, message],
      tools: tools.length > 0 ? this.#convertToolsToOpenAI(tools) : undefined,
    }

    // Log the request body for debugging
    trace(`Request body: ${JSON.stringify(body, null, 2)}\n`)
    return fetch(API_URL, {
      method: 'POST',
      headers: new Headers([
        ['Content-Type', 'application/json'],
        ['Authorization', `Bearer ${this.#apiKey}`],
      ]),
      body: JSON.stringify(body),
    })
      .then(async (response: { status: number; statusText: string; arrayBuffer(): Promise<ArrayBuffer> }) => {
        const status = response.status
        if (2 !== Math.idiv(status, 100)) {
          // Read error response body for details
          const errorBuffer = await response.arrayBuffer()
          const errorBody = String.fromArrayBuffer(errorBuffer)
          trace(`Error response body: ${errorBody}\n`)
          throw Error(`http·requestfailed, status ${status} ${response.statusText}`)
        }
        return response.arrayBuffer()
      })
      .then((buffer: ArrayBuffer) => {
        const body = String.fromArrayBuffer(buffer)
        // return JSON.parse(body, ['output', 'content', 'type', 'text', 'role'])
        return JSON.parse(body)
      })
      .then(async (obj: unknown) => {
        return await this.#extractResponseMessage(obj)
      })
  }

  async #extractResponseMessage(responseObj: unknown): Promise<ChatContent | null> {
    const parsedResponse = responseObj as ResponseObject
    const output = parsedResponse.output?.[0]

    // Log the response structure for debugging
    trace(`Full response structure: ${JSON.stringify(parsedResponse)}\n`)

    if (output?.type === 'message' && output.role === 'assistant') {
      const textContent = output.content?.find((c: ResponseContent) => c.type === 'output_text')
      if (textContent?.text) {
        return {
          role: 'assistant',
          content: textContent.text,
        }
      }

      // Check for tool calls
      const toolCallContent = output.content?.find((c: ResponseContent) => c.type === 'tool_use')
      if (toolCallContent?.name && toolCallContent.input) {
        try {
          const toolResult = await this.#executeIntegratedTool(toolCallContent.name, toolCallContent.input)
          return {
            role: 'assistant',
            content: `Tool result: ${toolResult}`,
          }
        } catch (error) {
          trace(`Tool call failed: ${error}\n`)
          return {
            role: 'assistant',
            content: 'ツールの呼び出しに失敗しました。',
          }
        }
      }
    }

    // Handle function calls (OpenAI Responses API format)
    if (output?.type === 'function_call') {
      trace(`Function call detected: ${JSON.stringify(output)}\n`)
      trace(`Output keys: ${Object.keys(output)}\n`)
      try {
        // Extract function call details - check all possible field names
        const functionName = output.name || output.function_name || output.tool_name
        const functionArgs = output.arguments || output.args || output.parameters || '{}'
        const parsedArgs = typeof functionArgs === 'string' ? JSON.parse(functionArgs) : functionArgs || {}

        trace(`Extracted - Name: ${functionName}, Args: ${JSON.stringify(parsedArgs)}\n`)
        const toolResult = await this.#executeIntegratedTool(functionName, parsedArgs)

        // Return the tool result as assistant message
        return {
          role: 'assistant',
          content: `計算結果: ${toolResult}`,
        }
      } catch (error) {
        trace(`Tool call error: ${error}\n`)
        return {
          role: 'assistant',
          content: `ツールの実行に失敗しました: ${error}`,
        }
      }
    }
    throw new Error('Invalid response format from Responses API')
  }

  async #executeIntegratedTool(toolName: string, input: Record<string, unknown>): Promise<string> {
    // First try local tools
    const localTool = this.#tools.find((tool) => tool.name === toolName)
    if (localTool) {
      const result = await localTool.execute(input)
      return typeof result === 'string' ? result : JSON.stringify(result)
    }

    // Then try MCP tools
    return await this.#executeMCPTool(toolName, input)
  }

  async #executeMCPTool(toolName: string, input: Record<string, unknown>): Promise<string> {
    for (const mcpClient of this.#mcpClients) {
      try {
        const mcpToolsList = await mcpClient.listTools()
        const mcpTool = mcpToolsList.tools.find((tool: ToolSchema) => tool.name === toolName)
        if (mcpTool) {
          const result = await mcpClient.callTool(toolName, input)
          return result.content[0].text
        }
      } catch (error) {
        trace(`MCP tool execution failed for ${toolName}: ${error}\n`)
      }
    }

    throw new Error(`Tool ${toolName} not found`)
  }
}
