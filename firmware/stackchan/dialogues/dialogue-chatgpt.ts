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
  #instructions: string
  #responseId?: string
  #mcpClients: MCPClientService[] = []
  #tools: Tool[] = []
  #toolsMap: Map<string, Tool> | null = null

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
    this.#instructions = instructions

    if (context?.length > 0) {
      // trace('Warning: "context" is deprecated. Use "instructions" instead.\n')
      let contextContent = ''
      for (const c of context) {
        contextContent += `${c.content}\n`
      }
      this.#instructions = contextContent + this.#instructions
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
    this.#toolsMap = null
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
    let resultText = ''
    let iterationCount = 0
    try {
      while (iterationCount < maxIterations) {
        // trace(`Conversation iteration ${iterationCount}/${maxIterations}\n`);
        iterationCount += 1
        if (currentMessages.length === 0) {
          // trace('No messages to send, ending conversation\n')
          return {
            success: true,
            value: resultText,
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
            const output = await this.#callTool(toolCall.name, toolCall.arguments)
            currentMessages.push({
              type: 'function_call_output',
              call_id: toolCall.id,
              output,
            })
          }
        }
        if (extractedMessage.messages.length > 0) {
          for (const message of extractedMessage.messages) {
            if (resultText) resultText += '\n'
            resultText += message.content
          }
        }
      }
      // Maximum iterations reached
      // trace(`Maximum iterations (${maxIterations}) reached\n`);
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

  async #getToolsMap(): Promise<Map<string, Tool>> {
    const toolsMap = new Map<string, Tool>()
    for (const tool of this.#tools) {
      if (!toolsMap.has(tool.name)) {
        toolsMap.set(tool.name, tool)
      } else {
        trace(`Warning: Duplicate tool name detected: ${tool.name}\n`)
      }
    }
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
          toolsMap.set(name, tool)
        }
      } catch (error) {
        trace(`MCP tool listing failed: ${error}\n`)
      }
    }
    return toolsMap
  }

  async #sendMessage(messages: Array<ChatContent | FunctionCallOutput>): Promise<unknown> {
    if (this.#toolsMap == null) {
      this.#toolsMap = await this.#getToolsMap()
    }
    const tools = Array.from(this.#toolsMap.values()).map((tool) => ({
      type: 'function',
      name: tool.name,
      description: tool.description || `Tool: ${tool.name}`,
      parameters: tool.inputSchema,
    }))
    const body = {
      model: this.#model,
      previous_response_id: this.#responseId,
      input: messages,
      instructions: this.#instructions,
      tools: tools.length > 0 ? tools : undefined,
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
    if (this.#toolsMap == null) {
      this.#toolsMap = await this.#getToolsMap()
    }
    const tool = this.#toolsMap.get(toolName)
    if (tool) {
      const result = await tool.execute(JSON.parse(args))
      return typeof result === 'string' ? result : JSON.stringify(result)
    }
    return `tool not found: ${toolName}\n`
  }
}
