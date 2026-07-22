export type ChatToolParameterSchema = {
  type?: string
  description?: string
  enum?: (string | number | boolean | null)[]
  properties?: Record<string, ChatToolParameterSchema>
  items?: ChatToolParameterSchema
  required?: string[]
  additionalProperties?: boolean | ChatToolParameterSchema
  minimum?: number
  maximum?: number
  minItems?: number
  maxItems?: number
}

export type ChatToolObjectSchema = ChatToolParameterSchema & {
  type: 'object'
  properties: Record<string, ChatToolParameterSchema>
}

export type ChatToolSchema = {
  name: string
  description?: string
  parameters?: ChatToolObjectSchema
  // Dialogue互換 (inputSchema) を許容
  inputSchema?: ChatToolObjectSchema
}

export type ChatTool = ChatToolSchema & {
  execute?: (params: Record<string, unknown>) => Promise<unknown> | unknown
}
