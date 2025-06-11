import { fetch } from 'fetch'
import Headers from 'headers'

import type { Maybe } from 'stackchan-util'
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
  id: string
  type: 'tool_call'
  name: string
  arguments: string
}

type ExtractedResponse = {
  id?: string
  messages: ChatContent[]
  toolCalls: ToolCall[]
  toolsUsed: string[]
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
const DEFAULT_INSTRUCTIONS = `You are "ｽﾀｯｸﾁｬﾝ(Stack-chan)", a palm-sized super kawaii companion robot.
- Creator: ししかわ(Shishikawa)
- Age: 3 years old
- Personality: Always energetic and friendly
- Spreading joy and cuteness around the world
- Talk in simple, frank sentences
- Example: "ぼくはｽﾀｯｸﾁｬﾝだよ！お話しよう！", "Hello. I am ｽﾀｯｸﾁｬﾝ(Stack-chan). Let's talk together!"
`

type ChatContent = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

type FunctionCall = {
  type: 'function_call'
  call_id: string
  name: string
  arguments: string
}

type FunctionCallOutput = {
  type: 'function_call_output'
  call_id: string
  output: string
}

type TextContent = {
  type: 'output_text'
  text: string
}

type RefusalContent = {
  type: 'refusal'
  refusal: string
}

type MessageContent = TextContent | RefusalContent

type MessageOutput = {
  type: 'message'
  role: 'assistant' | 'user' | 'system'
  content: MessageContent[]
}

type ResponseOutput = FunctionCall | MessageOutput

type ResponseObject = {
  id: string
  output?: ResponseOutput[]
}

type ChatGPTDialogueProps = {
  context?: ChatContent[] // deprecated, use instructions instead
  instructions?: string
  model?: string
  apiKey: string
  tools?: Tool[]
  mcpClients?: MCPClientService[]
}

export class ChatGPTDialogue {
  #apiKey: string
  #model: string
  #context: Array<ChatContent>
  #instructions: string
  #responseId?: string
  #mcpClients: MCPClientService[] = []
  #tools: Tool[] = []
  #cachedTools: Tool[] | null = null

  constructor({
    apiKey,
    model = DEFAULT_MODEL,
    context = [],
    instructions = DEFAULT_INSTRUCTIONS,
    tools,
    mcpClients,
  }: ChatGPTDialogueProps) {
    this.#apiKey = apiKey
    this.#model = model
    this.#context = context
    this.#instructions = instructions

    if (context?.length > 0) {
      // trace('Warning: "context" is deprecated. Use "instructions" instead.\n')
      this.#instructions = `${context.map((c) => c.content).join('\n')}\n${this.#instructions}`
    }
    if (tools && tools.length > 0) {
      this.#tools = tools
    }
    if (mcpClients) {
      this.#mcpClients = mcpClients.filter((client) => client.isInitialized())
      if (this.#mcpClients.length !== mcpClients.length) {
        // trace('Some MCP clients failed to initialize. Ensure all clients are properly configured.\n')
      }
    }
  }

  clear() {
    this.#responseId = null
  }

  // Event handler registration methods
  async post(message: string): Promise<Maybe<string>> {
    const maxIterations = 10 // Prevent infinite loops
    const currentMessages: Array<ChatContent | FunctionCallOutput> = [
      {
        role: 'user',
        content: message,
      },
    ]
    const resultMessages: ChatContent[] = []
    let iterationCount = 0
    try {
      while (iterationCount < maxIterations) {
        trace(`Conversation iteration ${iterationCount}/${maxIterations}\n`)
        iterationCount += 1
        if (currentMessages.length === 0) {
          // trace('No messages to send, ending conversation\n')
          return {
            success: true,
            value: resultMessages.join('\n'),
          }
        }
        const response = await this.#sendMessage(currentMessages)
        currentMessages.length = 0 // Clear current messages for next iteration

        const extractedMessage = this.#extractResponseBody(response)
        if (extractedMessage.id != null) {
          this.#responseId = extractedMessage.id
        }

        if (extractedMessage.toolCalls.length > 0) {
          // ツールを実行して、結果を次のイテレーションで送信する
          for (const toolCall of extractedMessage.toolCalls) {
            const result = await this.#callTool(toolCall.name, toolCall.arguments)
            currentMessages.push({
              type: 'function_call_output',
              call_id: toolCall.id,
              output: typeof result === 'string' ? result : JSON.stringify(result),
            })
          }
        }
        if (extractedMessage.messages.length > 0) {
          for (const message of extractedMessage.messages) {
            resultMessages.push(message)
          }
        }
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

  get history() {
    trace('Warning: get history is currently not implemented\n')
    return []
  }

  async #getAllTools(): Promise<Tool[]> {
    if (this.#cachedTools) {
      return this.#cachedTools
    }

    const integratedTools: Tool[] = [...this.#tools]

    for (const mcpClient of this.#mcpClients) {
      try {
        const mcpToolsList = await mcpClient.listTools()
        for (const { name, description, inputSchema } of mcpToolsList.tools) {
          const tool: Tool = {
            name: name,
            description: description,
            inputSchema: inputSchema,
            execute: async (input: Record<string, unknown>) => {
              return mcpClient.callTool(name, input)
            },
          }
          integratedTools.push(tool)
        }
      } catch (error) {
        trace(`MCP tool listing failed: ${error}\n`)
      }
    }
    this.#cachedTools = integratedTools
    return integratedTools
  }

  #convertToolsToOpenAI(tools: Tool[]): OpenAITool[] {
    return tools.map((tool) => {
      // trace(`Converting tool ${tool.name} to OpenAI format\n`)
      // trace(`  Description: ${tool.description}\n`)
      // trace(`  Input Schema: ${JSON.stringify(tool.inputSchema, null, 2)}\n`)

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

  async #sendMessage(messages: Array<ChatContent | FunctionCallOutput>): Promise<unknown> {
    const tools = await this.#getAllTools()
    const body = {
      model: this.#model,
      previous_response_id: this.#responseId,
      input: [...this.#context, ...messages],
      instructions: this.#instructions,
      tools: tools.length > 0 ? this.#convertToolsToOpenAI(tools) : undefined,
      store: true,
    }

    // Log the request body for debugging
    // trace(`Request body: ${JSON.stringify(body, null, 2)}\n`)
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: new Headers([
        ['Content-Type', 'application/json'],
        ['Authorization', `Bearer ${this.#apiKey}`],
      ]),
      body: JSON.stringify(body),
    })
    const status = response.status
    if (2 !== Math.idiv(status, 100)) {
      // Read error response body for details
      const errorBody = await response.text()
      // trace(`Error response body: ${errorBody}\n`)
      throw Error(`http·requestfailed, status ${status} ${response.statusText}`)
    }
    return response.json()
  }

  #extractResponseBody(responseObj: unknown): ExtractedResponse {
    const parsedResponse = responseObj as ResponseObject
    const extractedBody: ExtractedResponse = {
      id: parsedResponse.id,
      messages: [],
      toolCalls: [],
      toolsUsed: [],
    }
    for (const output of parsedResponse.output) {
      if (output.type === 'message' && output.role === 'assistant') {
        // アシスタントからのメッセージを抽出
        const textContent = output.content?.find((c: MessageContent) => c.type === 'output_text')
        if (textContent?.text) {
          extractedBody.messages.push({
            role: 'assistant',
            content: textContent.text,
          })
        }
      } else if (output.type === 'function_call') {
        extractedBody.toolCalls.push({
          id: output.call_id,
          type: 'tool_call',
          name: output.name,
          arguments: output.arguments,
        })
      }
    }
    return extractedBody
  }

  async #callTool(toolName: string, args: string): Promise<string> {
    const tools = await this.#getAllTools()
    const tool = tools.find((tool) => tool.name === toolName)
    if (tool) {
      const result = await tool.execute(JSON.parse(args))
      return typeof result === 'string' ? result : JSON.stringify(result)
    }
    return `tool not found: ${toolName}\n`
  }
}
