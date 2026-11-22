import { checkScope, failure } from 'stackchan-ai-core'
import { consumeSSE, ImageURL, jsonBody, type SendResponseRequest } from 'stackchan-ai-wire'
import type { LLM, OutputItem, ResponseRequest } from '../voice/contracts.js'

type Call = { id: string; type: 'function'; function: { name: string; arguments: string }; extra_content?: unknown }
type WireMessage = {
  role: string
  content: unknown
  tool_call_id?: string
  tool_calls?: Call[]
  extra_content?: unknown
}
type Continuation = { calls: Record<string, unknown>; messages: Record<string, unknown> }

function messages(request: ResponseRequest, provider: string): WireMessage[] {
  const result: WireMessage[] = []
  const calls = new Map<string, unknown>(),
    extra = new Map<string, unknown>()
  for (const item of request.input)
    if (item.type === 'provider_item') {
      if (item.provider !== provider) throw failure('unsupported_capability', 'incompatible provider item')
      const state = item.value as Continuation
      for (const [id, v] of Object.entries(state.calls)) calls.set(id, v)
      for (const [id, v] of Object.entries(state.messages)) extra.set(id, v)
    }
  if (request.instructions) result.push({ role: 'system', content: request.instructions })
  for (const item of request.input) {
    if (item.type === 'provider_item') continue
    if (item.type === 'function_call_output')
      result.push({ role: 'tool', tool_call_id: item.call_id, content: item.output })
    else if (item.type === 'function_call') {
      let message = result[result.length - 1]
      if (message?.role !== 'assistant') {
        message = { role: 'assistant', content: null }
        result.push(message)
      }
      message.tool_calls ??= []
      message.tool_calls.push({
        id: item.call_id,
        type: 'function',
        function: { name: item.name, arguments: item.arguments },
        extra_content: calls.get(item.call_id),
      })
    } else if (item.role === 'assistant') {
      result.push({
        role: 'assistant',
        content: item.content.map((p) => (p.type === 'refusal' ? p.refusal : p.text)).join(''),
        extra_content: extra.get(item.id),
      })
    } else {
      result.push({
        role: item.role === 'developer' ? 'system' : item.role,
        content: item.content.map((p) =>
          p.type === 'input_text'
            ? { type: 'text', text: p.text }
            : {
                type: 'image_url',
                image_url: {
                  url: 'image' in p ? new ImageURL(p.image) : p.image_url,
                  detail: p.detail,
                },
              },
        ),
      })
    }
  }
  return result
}

export function createChatLLM(options: {
  model: string
  provider: string
  send: SendResponseRequest
  maxRequestBytes?: number
  maxEventBytes?: number
}): LLM {
  const { model, provider, send, maxRequestBytes = 512 * 1024, maxEventBytes = 32768 } = options
  if (
    !model ||
    !Number.isSafeInteger(maxRequestBytes) ||
    maxRequestBytes < 1 ||
    !Number.isSafeInteger(maxEventBytes) ||
    maxEventBytes < 128
  )
    throw RangeError('invalid Chat Completions configuration')
  let sequence = 0
  return {
    capabilities: { tools: true, image: true },
    async createResponse(request, scope) {
      checkScope(scope)
      const body = jsonBody(
        {
          model,
          stream: true,
          messages: messages(request, provider),
          tools: request.tools?.length
            ? request.tools.map(({ type, ...definition }) => ({ type, function: definition }))
            : undefined,
          tool_choice: request.tool_choice,
          max_tokens: request.max_output_tokens ?? 1024,
        },
        maxRequestBytes,
      )
      const localId = 'completion-' + ++sequence
      let id: string | undefined,
        text = '',
        rejected = '',
        finish: string | undefined,
        used = 0
      let messageExtra: unknown, usage: { input_tokens: number; output_tokens: number } | undefined
      const toolCalls = new Map<number, Call>()
      function reserve(s: string) {
        used += s.length
        if (used > maxEventBytes) throw failure('resource_exhausted', 'completion exceeds result budget')
      }
      const receive = consumeSSE(maxEventBytes, scope, async (data) => {
        const chunk = JSON.parse(data)
        if (chunk.error) throw failure('provider_failed', 'Chat Completions request failed')
        id ??= chunk.id ?? localId
        if (chunk.usage)
          usage = { input_tokens: chunk.usage.prompt_tokens, output_tokens: chunk.usage.completion_tokens }
        const choice = chunk.choices?.[0]
        if (!choice) return
        const delta = choice.delta ?? {}
        if (typeof delta.content === 'string') {
          reserve(delta.content)
          text += delta.content
          await scope.onEvent?.({ type: 'response.output_text.delta', item_id: id + '/message', delta: delta.content })
        }
        if (typeof delta.refusal === 'string') {
          reserve(delta.refusal)
          rejected += delta.refusal
        }
        if (delta.extra_content) {
          reserve(JSON.stringify(delta.extra_content))
          messageExtra = delta.extra_content
        }
        for (const [fallback, part] of (delta.tool_calls ?? []).entries()) {
          const index = part.index ?? fallback
          if (!Number.isInteger(index) || index < 0 || index >= 32)
            throw failure('resource_exhausted', 'invalid tool call index')
          let call = toolCalls.get(index)
          if (!call) {
            call = { id: '', type: 'function', function: { name: '', arguments: '' } }
            toolCalls.set(index, call)
          }
          if (part.id) {
            reserve(part.id)
            call.id = part.id
          }
          if (part.function?.name) {
            reserve(part.function.name)
            call.function.name += part.function.name
          }
          if (part.function?.arguments) {
            const args = part.function.arguments
            reserve(args)
            call.function.arguments += args
            await scope.onEvent?.({
              type: 'response.function_call_arguments.delta',
              item_id: id + '/call/' + index,
              delta: args,
            })
          }
          if (part.extra_content) {
            reserve(JSON.stringify(part.extra_content))
            call.extra_content = part.extra_content
          }
        }
        if (choice.finish_reason) finish = choice.finish_reason
      })
      await send(body, receive, scope)
      checkScope(scope)
      if (!finish || !id) throw failure('provider_failed', 'completion ended before finish reason')
      const output: OutputItem[] = []
      const state: Continuation = { calls: Object.create(null), messages: Object.create(null) }
      if (text || rejected || messageExtra) {
        const key = id + '/message'
        output.push({
          type: 'message',
          role: 'assistant',
          id: key,
          content: [
            ...(text ? [{ type: 'output_text' as const, text }] : []),
            ...(rejected ? [{ type: 'refusal' as const, refusal: rejected }] : []),
          ],
        })
        if (messageExtra) state.messages[key] = messageExtra
      }
      for (const [index, call] of [...toolCalls].sort((a, b) => a[0] - b[0])) {
        if (!call.id || !call.function.name) {
          if (finish === 'length') continue
          throw failure('provider_failed', 'incomplete function call')
        }
        output.push({ type: 'function_call', id: id + '/call/' + index, call_id: call.id, ...call.function })
        if (call.extra_content) state.calls[call.id] = call.extra_content
      }
      if (Object.keys(state.calls).length || Object.keys(state.messages).length)
        output.push({ type: 'provider_item', provider, id: id + '/continuation', value: state })
      return { id, status: finish === 'stop' || finish === 'tool_calls' ? 'completed' : 'incomplete', output, usage }
    },
  }
}
