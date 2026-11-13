import { createChatLLM } from 'stackchan-ai-chat'
import { createAgent, createToolSet, createVision } from 'stackchan-ai-core'
import { createResponseTransport } from 'stackchan-ai-http'
import { createResponsesLLM } from 'stackchan-ai-responses'
import type { Agent as AgentType, LLM, ToolSet as ToolSetType, Vision as VisionType } from '../voice/contracts.js'

export type { Tool } from 'stackchan-ai-core'
export {
  adaptRobotCamera,
  asDelegateAgent,
  outputText,
  toolsFromMCP,
} from 'stackchan-ai-core'
export type { AgentResult, FunctionDefinition, InputItem, LLM } from '../voice/contracts.js'
export type Agent = AgentType
export type ToolSet = ToolSetType
export type Vision = VisionType
export const Agent = { create: createAgent }
export const ToolSet = { create: createToolSet }
export const Vision = { create: createVision }

export type OpenAIResponsesOptions = {
  apiKey?: string
  model: string
  endpoint?: string
  timeoutMs?: number
  maxPendingBytes?: number
  maxRequestBytes?: number
  maxEventBytes?: number
}

export const OpenAIResponsesLLM = {
  create({
    apiKey = '',
    model,
    endpoint = 'https://api.openai.com/v1/responses',
    timeoutMs = 45000,
    maxPendingBytes = 16384,
    maxRequestBytes,
    maxEventBytes,
  }: OpenAIResponsesOptions): LLM {
    if (
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs <= 0 ||
      !Number.isSafeInteger(maxPendingBytes) ||
      maxPendingBytes <= 0
    )
      throw RangeError('invalid transport budget')
    return createResponsesLLM({
      model,
      provider: endpoint + '#' + model,
      maxRequestBytes,
      maxEventBytes,
      send: createResponseTransport(endpoint, apiKey, timeoutMs, maxPendingBytes),
    })
  },
}
function createChatCompletionsLLM({
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
export const ChatCompletionsLLM = { create: createChatCompletionsLLM }
export const ClaudeLLM = {
  create(options: Omit<OpenAIResponsesOptions, 'endpoint'> & { workspaceId?: string }): LLM {
    return createChatCompletionsLLM({ ...options, endpoint: 'https://api.anthropic.com/v1/chat/completions' })
  },
}
export const GeminiLLM = {
  create(options: Omit<OpenAIResponsesOptions, 'endpoint'>): LLM {
    return createChatCompletionsLLM({
      ...options,
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    })
  },
}
