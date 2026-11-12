import { createChatLLM } from 'stackchan-ai-chat'
import { createResponseTransport } from 'stackchan-ai-http'
import { createResponsesLLM } from 'stackchan-ai-responses'
import type { LLM, ResponseEvent, ResponseRequest, Scope } from '../voice/contracts.js'

export type { Tool } from 'stackchan-ai-core'
export {
  adaptRobotCamera,
  asDelegateAgent,
  createAgent,
  createToolSet,
  createVision,
  outputText,
  toolsFromMCP,
} from 'stackchan-ai-core'
export type { Agent, AgentResult, FunctionDefinition, InputItem, LLM, ToolSet, Vision } from '../voice/contracts.js'

export type OpenAIResponsesOptions = {
  apiKey?: string
  model: string
  endpoint?: string
  timeoutMs?: number
  maxPendingBytes?: number
  maxRequestBytes?: number
  maxEventBytes?: number
}

export class OpenAIResponsesLLM implements LLM {
  readonly capabilities = { image: true, tools: true }
  #model: LLM
  constructor({
    apiKey = '',
    model,
    endpoint = 'https://api.openai.com/v1/responses',
    timeoutMs = 45000,
    maxPendingBytes = 16384,
    maxRequestBytes,
    maxEventBytes,
  }: OpenAIResponsesOptions) {
    if (
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs <= 0 ||
      !Number.isSafeInteger(maxPendingBytes) ||
      maxPendingBytes <= 0
    )
      throw RangeError('invalid transport budget')
    this.#model = createResponsesLLM({
      model,
      provider: endpoint + '#' + model,
      maxRequestBytes,
      maxEventBytes,
      send: createResponseTransport(endpoint, apiKey, timeoutMs, maxPendingBytes),
    })
  }
  createResponse(
    request: ResponseRequest,
    options: Scope & { onEvent?: (event: ResponseEvent) => void | Promise<void> },
  ) {
    return this.#model.createResponse(request, options)
  }
}
export function createChatCompletionsLLM({
  apiKey = '',
  model,
  endpoint,
  timeoutMs = 45000,
  maxPendingBytes = 16384,
  maxRequestBytes,
  maxEventBytes,
  workspaceId,
}: OpenAIResponsesOptions & { endpoint: string; workspaceId?: string }): LLM {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    !Number.isSafeInteger(maxPendingBytes) ||
    maxPendingBytes <= 0
  )
    throw RangeError('invalid transport budget')
  return createChatLLM({
    model,
    provider: endpoint + '#' + model,
    maxRequestBytes,
    maxEventBytes,
    send: createResponseTransport(
      endpoint,
      apiKey,
      timeoutMs,
      maxPendingBytes,
      workspaceId ? { 'anthropic-workspace-id': workspaceId } : undefined,
    ),
  })
}
export function createClaudeLLM(options: Omit<OpenAIResponsesOptions, 'endpoint'> & { workspaceId?: string }): LLM {
  return createChatCompletionsLLM({ ...options, endpoint: 'https://api.anthropic.com/v1/chat/completions' })
}
export function createGeminiLLM(options: Omit<OpenAIResponsesOptions, 'endpoint'>): LLM {
  return createChatCompletionsLLM({
    ...options,
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  })
}
