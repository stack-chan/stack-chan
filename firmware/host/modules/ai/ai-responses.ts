import type { LLM, ModelResponse, OutputItem, ResponseEvent, ResponseRequest } from '../voice/contracts.js'
import { checkScope, failure } from 'stackchan-ai-core'
import { consumeSSE, jsonBody, ImageURL, type SendResponseRequest, type Body } from 'stackchan-ai-wire'
export type { Body, ResponseConsumer, SendResponseRequest } from 'stackchan-ai-wire'

export function prepareBody(request: ResponseRequest, model: string, provider: string, maxBytes: number): Body {
  const input = request.input.map((item) => {
    if (item.type === 'provider_item') {
      if (item.provider !== provider) throw failure('unsupported_capability', 'incompatible provider item')
      return item.value
    }
    if (item.type !== 'message' || item.role === 'assistant') return item
    return {
      ...item,
      content: item.content.map((part) =>
        part.type === 'input_image' && 'image' in part
          ? { type: part.type, detail: part.detail, image_url: new ImageURL(part.image) }
          : part,
      ),
    }
  })
  return jsonBody(
    {
      model,
      stream: true,
      store: false,
      include: ['reasoning.encrypted_content'],
      instructions: request.instructions,
      tools: request.tools,
      tool_choice: request.tool_choice,
      max_output_tokens: request.max_output_tokens ?? 1024,
      input,
    },
    maxBytes,
  )
}

function parseResponse(
  value: { id?: unknown; status?: unknown; output?: unknown; usage?: ModelResponse['usage'] },
  provider: string,
): ModelResponse {
  if (
    typeof value?.id !== 'string' ||
    !Array.isArray(value.output) ||
    (value.status !== 'completed' && value.status !== 'incomplete')
  )
    throw Error('invalid Responses object')
  const output = value.output.map((item): OutputItem => {
    if (!item || typeof item.type !== 'string' || typeof item.id !== 'string') throw Error('invalid output item')
    if (item.type === 'message') {
      if (
        item.role !== 'assistant' ||
        !Array.isArray(item.content) ||
        !item.content.every(
          (p: { type?: unknown; text?: unknown; refusal?: unknown } | null) =>
            (p?.type === 'output_text' && typeof p.text === 'string') ||
            (p?.type === 'refusal' && typeof p.refusal === 'string'),
        )
      )
        throw Error('invalid assistant message')
      return item
    }
    if (item.type === 'function_call') {
      if (typeof item.call_id !== 'string' || typeof item.arguments !== 'string' || typeof item.name !== 'string')
        throw Error('invalid function call')
      return item
    }
    return { type: 'provider_item', provider, id: item.id, value: item }
  })
  return { id: value.id, status: value.status, output, usage: value.usage }
}

export function createResponsesLLM(options: {
  model: string
  provider: string
  send: SendResponseRequest
  maxRequestBytes?: number
  maxEventBytes?: number
}): LLM {
  const { model, provider, send, maxRequestBytes = 512 * 1024, maxEventBytes = 32 * 1024 } = options
  if (
    !model ||
    !Number.isSafeInteger(maxRequestBytes) ||
    maxRequestBytes < 1 ||
    !Number.isSafeInteger(maxEventBytes) ||
    maxEventBytes < 128
  )
    throw RangeError('invalid Responses configuration')
  return {
    capabilities: { image: true, tools: true },
    async createResponse(request, scope) {
      checkScope(scope)
      const body = prepareBody(request, model, provider, maxRequestBytes)
      let result: ModelResponse | undefined
      const phases = new Map<string, 'commentary' | 'final_answer'>()
      const receive = consumeSSE(maxEventBytes, scope, async (data) => {
        const message = JSON.parse(data)
        switch (message.type) {
          case 'response.output_item.added':
          case 'response.output_item.updated': {
            const item = message.item
            if (
              item?.type === 'message' &&
              typeof item.id === 'string' &&
              (item.phase === 'commentary' || item.phase === 'final_answer')
            ) {
              if (phases.size >= 64 && !phases.has(item.id))
                throw failure('resource_exhausted', 'too many active response items')
              phases.set(item.id, item.phase)
            }
            break
          }
          case 'response.output_item.done':
            phases.delete(message.item?.id)
            break
          case 'response.output_text.delta':
          case 'response.function_call_arguments.delta':
            if (typeof message.item_id !== 'string' || typeof message.delta !== 'string')
              throw Error('invalid response delta')
            if (scope.onEvent) {
              const event: ResponseEvent =
                message.type === 'response.output_text.delta'
                  ? {
                      type: message.type,
                      item_id: message.item_id,
                      delta: message.delta,
                      phase: phases.get(message.item_id),
                    }
                  : { type: message.type, item_id: message.item_id, delta: message.delta }
              await scope.onEvent(event)
            }
            break
          case 'response.completed':
          case 'response.incomplete':
            result = parseResponse(message.response, provider)
            break
          case 'response.failed':
          case 'error':
            throw failure(
              'provider_failed',
              'Responses request failed: ' + (message.code ?? message.response?.error?.code ?? 'unknown'),
            )
        }
      })
      await send(body, receive, scope, () => result !== undefined)
      checkScope(scope)
      if (!result) throw failure('provider_failed', 'response ended before completion')
      return result
    },
  }
}
