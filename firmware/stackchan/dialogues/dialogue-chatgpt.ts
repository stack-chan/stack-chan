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

type ToolCall = {
  type: 'tool_call'
  name: string
  input: Record<string, unknown>
}

type ExtractedResponse = ChatContent | ToolCall | ToolCall[] | null

// Event system types
type ToolCallEvent = {
  toolName: string
  input: Record<string, unknown>
  timestamp: number
}

type ToolCallEventHandlers = {
  onToolCallStarted?: (event: ToolCallEvent) => void
  onToolCallCompleted?: (event: ToolCallEvent & { result: string }) => void
  onToolCallFailed?: (event: ToolCallEvent & { error: Error }) => void
}

type OpenAITool = {
  type: 'function'
  name: string
  description: string
  parameters: Record<string, unknown>
}

// Simplified flow: initial message -> tool execution (if needed) -> final response

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

function isToolCall(c: unknown): c is ToolCall {
  return (
    c != null &&
    typeof c === 'object' &&
    'type' in c &&
    c.type === 'tool_call' &&
    'name' in c &&
    typeof c.name === 'string' &&
    'input' in c &&
    typeof c.input === 'object'
  )
}

function isMultipleToolCalls(c: unknown): c is ToolCall[] {
  return Array.isArray(c) && c.length > 0 && c.every(isToolCall)
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
  eventHandlers?: ToolCallEventHandlers
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
  #eventHandlers: ToolCallEventHandlers = {}

  constructor({
    apiKey,
    model = DEFAULT_MODEL,
    context = DEFAULT_CONTEXT,
    tools,
    mcpClients,
    eventHandlers,
  }: ChatGPTDialogueProps) {
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
    if (eventHandlers) {
      this.#eventHandlers = eventHandlers
    }

    // Initialize MCP tools on startup
    this.#mcpInitPromise = this.#initializeMCPTools()
  }

  clear() {
    this.#history.splice(0)
  }

  // Event system methods
  #fireToolCallStarted(toolName: string, input: Record<string, unknown>): void {
    if (this.#eventHandlers.onToolCallStarted) {
      const event: ToolCallEvent = {
        toolName,
        input,
        timestamp: Date.now(),
      }
      this.#eventHandlers.onToolCallStarted(event)
    }
  }

  #fireToolCallCompleted(toolName: string, input: Record<string, unknown>, result: string): void {
    if (this.#eventHandlers.onToolCallCompleted) {
      const event: ToolCallEvent & { result: string } = {
        toolName,
        input,
        timestamp: Date.now(),
        result,
      }
      this.#eventHandlers.onToolCallCompleted(event)
    }
  }

  #fireToolCallFailed(toolName: string, input: Record<string, unknown>, error: Error): void {
    if (this.#eventHandlers.onToolCallFailed) {
      const event: ToolCallEvent & { error: Error } = {
        toolName,
        input,
        timestamp: Date.now(),
        error,
      }
      this.#eventHandlers.onToolCallFailed(event)
    }
  }

  // Event handler registration methods
  setEventHandlers(handlers: ToolCallEventHandlers): void {
    this.#eventHandlers = { ...this.#eventHandlers, ...handlers }
  }

  addEventListener<K extends keyof ToolCallEventHandlers>(
    eventType: K,
    handler: NonNullable<ToolCallEventHandlers[K]>,
  ): void {
    this.#eventHandlers[eventType] = handler
  }

  removeEventListener(eventType: keyof ToolCallEventHandlers): void {
    delete this.#eventHandlers[eventType]
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

    return await this.#executeConversationFlow(message, allTools)
  }

  async #executeConversationFlow(message: string, allTools: Tool[]): Promise<Maybe<string>> {
    const maxIterations = 10 // Prevent infinite loops
    let currentMessage: ChatContent = {
      role: 'user',
      content: message,
    }
    let iterationCount = 0

    // Add initial user message to history
    this.#history.push(currentMessage)

    try {
      while (iterationCount < maxIterations) {
        trace(`Conversation iteration ${iterationCount + 1}/${maxIterations}\n`)
        const response = await this.#sendMessage(currentMessage, allTools)

        if (isChatContent(response)) {
          // AI responded with regular chat - conversation complete
          this.#history.push(response)
          this.#trimHistory()

          return {
            success: true,
            value: response.content,
          }
        }

        if (isToolCall(response)) {
          // AI wants to use a single tool
          trace(`Tool call detected: ${response.name} (iteration ${iterationCount + 1})\n`)

          try {
            // Fire tool call started event
            this.#fireToolCallStarted(response.name, response.input)

            const toolResult = await this.#executeIntegratedTool(response.name, response.input)
            trace(`Tool execution result: ${toolResult}\n`)

            // Fire tool call completed event
            this.#fireToolCallCompleted(response.name, response.input, toolResult)

            // Create tool result message for next iteration
            currentMessage = {
              role: 'user',
              content: `Tool "${response.name}" result: ${toolResult}`,
            }
            this.#history.push(currentMessage)

            iterationCount++
            continue // Continue to next iteration
          } catch (error) {
            trace(`Tool execution failed: ${error}\n`)

            // Fire tool call failed event
            this.#fireToolCallFailed(response.name, response.input, error as Error)

            // Send error message to AI
            currentMessage = {
              role: 'user',
              content: `Tool "${response.name}" failed: ${error}`,
            }
            this.#history.push(currentMessage)

            iterationCount++
            continue // Continue to next iteration
          }
        }

        if (isMultipleToolCalls(response)) {
          // AI wants to use multiple tools in parallel
          trace(`Multiple tool calls detected: ${response.length} tools (iteration ${iterationCount + 1})\n`)

          try {
            const combinedResult = await this.#executeMultipleToolsParallel(response)
            trace('Multiple tool execution completed\n')

            // Create combined tool result message for next iteration
            currentMessage = {
              role: 'user',
              content: combinedResult,
            }
            this.#history.push(currentMessage)

            iterationCount++
            continue // Continue to next iteration
          } catch (error) {
            trace(`Multiple tool execution failed: ${error}\n`)

            // Send error message to AI
            const toolNames = response.map((call) => call.name).join(', ')
            currentMessage = {
              role: 'user',
              content: `Multiple tools [${toolNames}] failed: ${error}`,
            }
            this.#history.push(currentMessage)

            iterationCount++
            continue // Continue to next iteration
          }
        }

        // Invalid response format
        return { success: false, reason: 'Invalid response format from AI' }
      }

      // Maximum iterations reached
      trace(`Maximum iterations (${maxIterations}) reached\n`)
      return {
        success: false,
        reason: `Conversation exceeded maximum iterations (${maxIterations})`,
      }
    } catch (error) {
      return { success: false, reason: error.message || 'Unknown error' }
    }
  }

  #trimHistory(): void {
    // Set maximum length to prevent memory overflow
    while (this.#history.length > this.#maxHistory) {
      this.#history.shift()
    }
  }

  async #executeMultipleToolsParallel(toolCalls: ToolCall[]): Promise<string> {
    trace(`Executing ${toolCalls.length} tools in parallel\n`)

    // Fire started events for all tools
    for (const toolCall of toolCalls) {
      this.#fireToolCallStarted(toolCall.name, toolCall.input)
    }

    // Execute all tools in parallel
    const results = await Promise.allSettled(
      toolCalls.map(async (toolCall) => {
        try {
          trace(`Starting parallel execution of tool: ${toolCall.name}\n`)
          const result = await this.#executeIntegratedTool(toolCall.name, toolCall.input)
          trace(`Completed parallel execution of tool: ${toolCall.name}\n`)

          // Fire tool call completed event
          this.#fireToolCallCompleted(toolCall.name, toolCall.input, result)

          return {
            toolName: toolCall.name,
            success: true,
            result: result,
          }
        } catch (error) {
          trace(`Failed parallel execution of tool: ${toolCall.name} - ${error}\n`)

          // Fire tool call failed event
          this.#fireToolCallFailed(toolCall.name, toolCall.input, error as Error)

          return {
            toolName: toolCall.name,
            success: false,
            error: String(error),
          }
        }
      }),
    )

    // Combine all results into a single message
    const resultMessages: string[] = []
    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      const toolCall = toolCalls[i]

      if (result.status === 'fulfilled') {
        const toolResult = result.value
        if (toolResult.success) {
          resultMessages.push(`Tool "${toolResult.toolName}" result: ${toolResult.result}`)
        } else {
          resultMessages.push(`Tool "${toolResult.toolName}" failed: ${toolResult.error}`)
        }
      } else {
        resultMessages.push(`Tool "${toolCall.name}" failed: ${result.reason}`)
      }
    }

    return resultMessages.join('\n')
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

  async #sendMessage(message: ChatContent, tools: Tool[]): Promise<ExtractedResponse> {
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

  async #extractResponseMessage(responseObj: unknown): Promise<ExtractedResponse> {
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

      // Check for multiple tool calls
      const toolCallContents = output.content?.filter((c: ResponseContent) => c.type === 'tool_use')
      if (toolCallContents && toolCallContents.length > 1) {
        // Multiple tool calls detected
        const toolCalls: ToolCall[] = toolCallContents
          .filter((tc) => tc.name && tc.input)
          .map((tc) => ({
            type: 'tool_call',
            name: tc.name as string,
            input: tc.input as Record<string, unknown>,
          }))

        if (toolCalls.length > 0) {
          return toolCalls
        }
      }

      // Check for single tool call
      const toolCallContent = output.content?.find((c: ResponseContent) => c.type === 'tool_use')
      if (toolCallContent?.name && toolCallContent.input) {
        return {
          type: 'tool_call',
          name: toolCallContent.name,
          input: toolCallContent.input,
        }
      }
    }

    // Handle function calls (OpenAI Responses API format)
    if (output?.type === 'function_call') {
      trace(`Function call detected: ${JSON.stringify(output)}\n`)
      trace(`Output keys: ${Object.keys(output)}\n`)
      // Extract function call details - check all possible field names
      const functionName = output.name || output.function_name || output.tool_name
      const functionArgs = output.arguments || output.args || output.parameters || '{}'
      const parsedArgs = typeof functionArgs === 'string' ? JSON.parse(functionArgs) : functionArgs || {}

      trace(`Extracted - Name: ${functionName}, Args: ${JSON.stringify(parsedArgs)}\n`)
      return {
        type: 'tool_call',
        name: functionName,
        input: parsedArgs,
      }
    }

    // Check for multiple function calls in the output array
    if (parsedResponse.output && parsedResponse.output.length > 1) {
      const functionCalls = parsedResponse.output.filter((o) => o?.type === 'function_call')
      if (functionCalls.length > 1) {
        const toolCalls: ToolCall[] = functionCalls.map((fc) => {
          const functionName = fc.name || fc.function_name || fc.tool_name
          const functionArgs = fc.arguments || fc.args || fc.parameters || '{}'
          const parsedArgs = typeof functionArgs === 'string' ? JSON.parse(functionArgs) : functionArgs || {}

          return {
            type: 'tool_call',
            name: functionName,
            input: parsedArgs,
          }
        })

        return toolCalls
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
