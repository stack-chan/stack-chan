import type { ChatTool } from 'chat'
import type { MCPClientService } from 'mcp-client'

type MCPToolList = Awaited<ReturnType<MCPClientService['listTools']>>

function normalizeToolResult(result: unknown): string {
  const content = (result as { content?: { type?: string; text?: string }[] })?.content
  if (Array.isArray(content)) {
    const text = content
      .filter((item) => item?.type === 'text' && typeof item.text === 'string')
      .map((item) => item.text)
      .join('\n')
    if (text.length > 0) return text
  }
  return typeof result === 'string' ? result : JSON.stringify(result)
}

export async function createMCPChatTools(clients: MCPClientService[]): Promise<Record<string, ChatTool>> {
  const tools: Record<string, ChatTool> = {}
  for (const client of clients) {
    const list = (await client.listTools()) as MCPToolList
    for (const tool of list.tools) {
      const name = tool.name
      tools[name] = {
        name,
        description: tool.description,
        parameters: tool.inputSchema,
        execute: async (params: Record<string, unknown>) => normalizeToolResult(await client.callTool(name, params)),
      }
    }
  }
  return tools
}
