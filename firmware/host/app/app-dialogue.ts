import { AppConnection, type AppServiceScope } from 'app-service-scope'
import { StackchanError } from 'stackchan/errors'
import type { Dialogue, DialogueMessage, DialogueOptions } from 'stackchan/extensions/conversation'
import type { TaskContext } from 'stackchan/task'

export type ConversationPost = (
  url: string,
  body: string | readonly ArrayBuffer[],
  headers: Record<string, string>,
  task: TaskContext,
) => Promise<Record<string, unknown>>

function messageText(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096)
    throw new StackchanError('INVALID_ARGUMENT', `${name} must contain 1–4096 characters`)
}
function blocks(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.some((item) => !item || typeof item !== 'object' || Array.isArray(item)))
    throw new StackchanError('IO', 'Conversation response has invalid content')
  return value
}
function append(answer: string, text: unknown): string {
  if (typeof text !== 'string') throw new StackchanError('IO', 'Conversation response has invalid text')
  const result = answer + (answer && text ? '\n' : '') + text
  if (result.length > 4096) throw new StackchanError('IO', 'Conversation answer exceeds the speech limit')
  return result
}

/** One lifetime and successful-turn checkpoint; providers only encode/decode their wire format. */
export function createDialogue(
  scope: AppServiceScope,
  options: DialogueOptions,
  defaults: { apiKey: string; instructions: string },
  post: ConversationPost,
): Dialogue {
  const provider = options.provider ?? 'openai'
  if (!['openai', 'claude', 'gemini'].includes(provider))
    throw new StackchanError('INVALID_ARGUMENT', 'Unknown dialogue provider')
  const apiKey = options.apiKey ?? defaults.apiKey
  const model = options.model ?? (provider === 'openai' ? 'gpt-4o-mini' : '')
  if (typeof apiKey !== 'string' || !apiKey || /[\r\n]/.test(apiKey))
    throw new StackchanError('CONFIG', 'Set an API key for the selected dialogue provider')
  if (typeof model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(model))
    throw new StackchanError('CONFIG', 'Set a model ID supported by the selected dialogue provider')
  const instructions = options.instructions ?? defaults.instructions
  messageText(instructions, 'Dialogue instructions')
  if (options.messages !== undefined && (!Array.isArray(options.messages) || options.messages.length > 16))
    throw new StackchanError('INVALID_ARGUMENT', 'Dialogue accepts up to 16 seed messages')
  const seeds = (options.messages ?? []).map((message) => {
    if (message?.role !== 'user' && message?.role !== 'assistant')
      throw new StackchanError('INVALID_ARGUMENT', 'Seed messages use user or assistant roles')
    messageText(message.content, 'Seed message')
    return { role: message.role, content: message.content }
  })
  if (seeds.length && seeds[0].role !== 'user')
    throw new StackchanError('INVALID_ARGUMENT', 'Seed messages must start with a user turn')
  if (options.tools !== undefined && (!Array.isArray(options.tools) || options.tools.length > 64))
    throw new StackchanError('INVALID_ARGUMENT', 'Dialogue accepts up to 64 tools')
  if (provider !== 'openai' && options.tools !== undefined)
    throw new StackchanError('UNSUPPORTED', 'Dialogue tools are supported by the OpenAI provider')
  const names = new Set<string>()
  const tools = (options.tools ?? []).map((tool) => {
    if (
      !tool ||
      typeof tool.name !== 'string' ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(tool.name) ||
      names.has(tool.name) ||
      typeof tool.execute !== 'function' ||
      tool.inputSchema?.type !== 'object'
    )
      throw new StackchanError('INVALID_ARGUMENT', 'Dialogue tools need unique names and an execute function')
    names.add(tool.name)
    return { ...tool, inputSchema: JSON.parse(JSON.stringify(tool.inputSchema)) }
  })
  const owner = new AppConnection(scope)
  let previous: string | undefined,
    busy = false
  let history: DialogueMessage[] = []
  owner.own(() => {
    previous = undefined
    history = []
  })
  return {
    close: owner.close,
    get history() {
      return owner.call(() => history.map((message) => ({ ...message })))
    },
    clear: () =>
      owner.call(() => {
        if (busy) throw new StackchanError('BUSY', 'Wait for the dialogue request before clearing it')
        previous = undefined
        history = []
      }),
    ask: (text, request) =>
      owner.run(async (task) => {
        if (busy) throw new StackchanError('BUSY', 'Dialogue is already answering')
        messageText(text, 'Dialogue text')
        busy = true
        try {
          const user: DialogueMessage = { role: 'user', content: text }
          let answer = '',
            current = previous
          if (provider === 'openai') {
            let input: Record<string, unknown>[] = [...(previous ? [] : seeds), user]
            for (let iteration = 0; iteration < 10; iteration++) {
              task.signal.throwIfCancelled()
              const response = await post(
                'https://api.openai.com/v1/responses',
                JSON.stringify({
                  model,
                  instructions,
                  previous_response_id: current,
                  input,
                  tools: tools.map((tool) => ({
                    type: 'function',
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.inputSchema,
                    strict: false,
                  })),
                }),
                { Authorization: `Bearer ${apiKey}` },
                task,
              )
              if (
                typeof response.id !== 'string' ||
                !response.id ||
                (response.status && response.status !== 'completed')
              )
                throw new StackchanError('IO', 'Conversation response is incomplete')
              current = response.id
              input = []
              for (const output of blocks(response.output)) {
                if (output.type === 'message') {
                  for (const content of blocks(output.content)) {
                    if (content.type === 'output_text') answer = append(answer, content.text)
                    else if (content.type === 'refusal') answer = append(answer, content.refusal)
                  }
                } else if (output.type === 'function_call') {
                  task.signal.throwIfCancelled()
                  if (typeof output.call_id !== 'string' || typeof output.arguments !== 'string')
                    throw new StackchanError('IO', 'Conversation returned an invalid tool call')
                  const tool = tools.find((tool) => tool.name === output.name)
                  let result: string
                  try {
                    const args: unknown = JSON.parse(output.arguments)
                    if (!args || typeof args !== 'object' || Array.isArray(args))
                      throw new Error('Tool arguments must be an object')
                    result = tool
                      ? await tool.execute(args as Record<string, unknown>, task)
                      : `Unknown tool: ${output.name}`
                    if (typeof result !== 'string' || result.length > 16384)
                      throw new Error('Tool result must be a string of at most 16384 characters')
                  } catch (error) {
                    task.signal.throwIfCancelled()
                    result = error instanceof Error ? error.message : 'Tool failed'
                  }
                  task.signal.throwIfCancelled()
                  input.push({ type: 'function_call_output', call_id: output.call_id, output: result })
                }
              }
              if (!input.length) break
              if (iteration === 9) throw new StackchanError('IO', 'Conversation exceeded 10 tool iterations')
            }
          } else {
            const messages = [...seeds, ...history, user]
            if (provider === 'claude') {
              const response = await post(
                'https://api.anthropic.com/v1/messages',
                JSON.stringify({
                  model,
                  max_tokens: 1024,
                  system: instructions,
                  messages,
                }),
                { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
                task,
              )
              if (
                response.role !== 'assistant' ||
                response.stop_reason === 'max_tokens' ||
                response.stop_reason === 'tool_use'
              )
                throw new StackchanError('IO', 'Claude returned no assistant message')
              for (const content of blocks(response.content))
                if (content.type === 'text') answer = append(answer, content.text)
            } else {
              const response = await post(
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
                JSON.stringify({
                  systemInstruction: { parts: [{ text: instructions }] },
                  contents: messages.map((message) => ({
                    role: message.role === 'assistant' ? 'model' : 'user',
                    parts: [{ text: message.content }],
                  })),
                }),
                { 'x-goog-api-key': apiKey },
                task,
              )
              const candidate = blocks(response.candidates)[0]
              if (candidate?.finishReason && candidate.finishReason !== 'STOP')
                throw new StackchanError('IO', 'Gemini did not complete its answer')
              const content = candidate?.content as { role?: unknown; parts?: unknown } | undefined
              if (content?.role !== 'model') throw new StackchanError('IO', 'Gemini returned no model message')
              for (const part of blocks(content.parts))
                if (part.text !== undefined && !part.thought) answer = append(answer, part.text)
            }
          }
          task.signal.throwIfCancelled()
          if (!answer) throw new StackchanError('IO', 'Conversation returned no text')
          previous = current
          history = [...history, user, { role: 'assistant' as const, content: answer }].slice(-6)
          return answer
        } finally {
          busy = false
        }
      }, request?.signal),
  }
}
