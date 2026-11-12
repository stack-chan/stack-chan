import type { RobotCamera } from '../camera/camera.js'
import type {
  Agent,
  AgentOptions,
  AgentResult,
  Camera,
  DelegateAgent,
  Failure,
  FunctionCall,
  FunctionDefinition,
  FunctionOutput,
  InputItem,
  Json,
  ModelResponse,
  Scope,
  ToolContext,
  ToolSet,
  Vision,
  VisionOptions,
} from '../voice/contracts.js'

export function failure(code: Failure['code'], message: string): Error & Failure {
  return Object.assign(new Error(message), { code })
}

export function checkScope({ signal }: Scope): void {
  if (signal.aborted) throw failure('cancelled', 'operation cancelled')
}

export function outputText(response: ModelResponse): string {
  return response.output
    .flatMap((item) =>
      item.type === 'message' && item.phase !== 'commentary'
        ? item.content.map((part) => (part.type === 'refusal' ? part.refusal : part.text))
        : [],
    )
    .join('')
}

export function asDelegateAgent(agent: Agent): DelegateAgent {
  const sessions = new Map<string, { active: number; retiring: boolean }>()
  return {
    releaseSession(id) {
      const session = sessions.get(id)
      if (session) session.retiring = true
      else agent.releaseSession?.(id)
    },
    async run(request, scope) {
      checkScope(scope)
      const id = request.sessionId
      if (!sessions.has(id) && sessions.size >= 16)
        throw failure('resource_exhausted', 'too many active delegation sessions')
      const session = sessions.get(id) ?? { active: 0, retiring: false }
      if (session.retiring) throw failure('cancelled', 'delegated session closed')
      sessions.set(id, session)
      session.active++
      try {
        const result = await agent.run(request, scope)
        checkScope(scope)
        if (session.retiring) throw failure('cancelled', 'delegated session closed')
        if ('error' in result) throw failure(result.error.code, result.error.message)
        if (result.status !== 'completed') throw failure('provider_failed', 'incomplete delegated response')
        return result.response.output.filter((item) => item.type === 'message' && item.phase !== 'commentary')
      } finally {
        if (--session.active === 0) {
          sessions.delete(id)
          if (session.retiring) agent.releaseSession?.(id)
        }
      }
    },
  }
}

export type Tool = {
  definition: FunctionDefinition
  execute(input: Record<string, Json>, context: ToolContext): unknown | Promise<unknown>
  validate?(input: Record<string, Json>): boolean
}

export async function toolsFromMCP(client: {
  listTools(): Promise<{
    tools: readonly { name: string; description?: string; inputSchema: FunctionDefinition['parameters'] }[]
  }>
  callTool(name: string, input: Record<string, Json>): Promise<unknown>
}): Promise<Tool[]> {
  return (await client.listTools()).tools.map(({ name, description, inputSchema }) => ({
    definition: { type: 'function', name, description: description ?? name, parameters: inputSchema, strict: false },
    execute: (input) => client.callTool(name, input),
  }))
}

function validate(value: Json, schema: Json, depth = 0): boolean {
  if (typeof schema === 'boolean') return schema
  if (!schema || typeof schema !== 'object' || Array.isArray(schema) || depth > 20) return false
  const spec = schema as Record<string, Json>
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
  const matchType = (name: Json) => type === name || (name === 'integer' && Number.isInteger(value))
  if (spec.type && !(Array.isArray(spec.type) ? spec.type.some(matchType) : matchType(spec.type))) return false
  if (Array.isArray(spec.enum) && !spec.enum.some((v) => JSON.stringify(v) === JSON.stringify(value))) return false
  if (spec.const !== undefined && JSON.stringify(spec.const) !== JSON.stringify(value)) return false
  if (type === 'object') {
    const object = value as Record<string, Json>
    if (
      Array.isArray(spec.required) &&
      !spec.required.every((key) => typeof key === 'string' && Object.hasOwn(object, key))
    )
      return false
    const props = (spec.properties ?? {}) as Record<string, Json>
    return Object.keys(object).every((key) =>
      validate(object[key], Object.hasOwn(props, key) ? props[key] : (spec.additionalProperties ?? true), depth + 1),
    )
  }
  if (Array.isArray(value) && spec.items !== undefined) return value.every((v) => validate(v, spec.items, depth + 1))
  if (typeof value === 'number')
    return !(
      (typeof spec.minimum === 'number' && value < spec.minimum) ||
      (typeof spec.maximum === 'number' && value > spec.maximum)
    )
  return true
}

type Execution = { sessionId: string; invocation: string; retained: number; result: Promise<FunctionOutput> }
const checkedKeywords = new Set([
  '$schema',
  'title',
  'description',
  'examples',
  'default',
  'type',
  'enum',
  'const',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'minimum',
  'maximum',
])

function checkSchema(schema: Json, custom: boolean, depth = 0): void {
  if (typeof schema === 'boolean') return
  if (depth > 20 || !schema || typeof schema !== 'object' || Array.isArray(schema))
    throw failure('unsupported_capability', 'invalid tool schema')
  const spec = schema as Record<string, Json>
  if (!custom && Object.keys(spec).some((key) => !checkedKeywords.has(key)))
    throw failure('unsupported_capability', 'supply a validator for this tool schema')
  for (const child of Object.values(spec.properties ?? {})) checkSchema(child, custom, depth + 1)
  if (spec.additionalProperties !== undefined) checkSchema(spec.additionalProperties, custom, depth + 1)
  if (spec.items !== undefined) checkSchema(spec.items, custom, depth + 1)
}

function freezeTree<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeTree(child)
    Object.freeze(value)
  }
  return value
}

export function createToolSet(
  tools: readonly Tool[] = [],
  options: { maxCalls?: number; maxOutputChars?: number; maxLogChars?: number } = {},
): ToolSet & { releaseSession(id: string): void } {
  const maxCalls = options.maxCalls ?? 128
  const maxOutput = options.maxOutputChars ?? 4096
  const maxLog = options.maxLogChars ?? 32768
  if (!Number.isSafeInteger(maxLog) || maxLog < maxOutput) throw RangeError('invalid tool log budget')
  if (!Number.isSafeInteger(maxCalls) || maxCalls < 1 || !Number.isSafeInteger(maxOutput) || maxOutput < 1)
    throw RangeError('invalid tool budget')
  const byName = new Map<string, Tool>()
  for (const tool of tools) {
    checkSchema(tool.definition.parameters, Boolean(tool.validate))
    if (byName.has(tool.definition.name)) throw Error('duplicate tool: ' + tool.definition.name)
    byName.set(tool.definition.name, { ...tool, definition: freezeTree(JSON.parse(JSON.stringify(tool.definition))) })
  }
  const executions = new Map<string, Execution>()
  let logSize = 0
  return {
    definitions: Object.freeze([...byName.values()].map((tool) => tool.definition)),
    releaseSession(id) {
      for (const [key, entry] of executions)
        if (entry.sessionId === id) {
          logSize -= entry.retained
          executions.delete(key)
        }
    },
    async execute(call, context) {
      checkScope(context)
      if (
        call.arguments.length > 8192 ||
        call.name.length > 128 ||
        call.call_id.length > 256 ||
        context.callId !== call.call_id
      )
        throw failure('tool_failed', 'invalid tool call identifier or argument size')
      const key = JSON.stringify([context.sessionId, context.turnId, call.call_id])
      const invocation = JSON.stringify([call.name, call.arguments])
      const existing = executions.get(key)
      if (existing) {
        if (existing.invocation !== invocation) throw failure('tool_failed', 'call ID reused with different arguments')
        return existing.result
      }
      const retained = key.length + invocation.length + maxOutput
      if (executions.size >= maxCalls || logSize + retained > maxLog)
        throw failure('resource_exhausted', 'tool execution log full')
      const tool = byName.get(call.name)
      if (!tool) throw failure('tool_failed', 'invalid tool call: ' + call.name)
      const input = JSON.parse(call.arguments)
      if (
        !input ||
        typeof input !== 'object' ||
        Array.isArray(input) ||
        !validate(input, tool.definition.parameters) ||
        (tool.validate && !tool.validate(input))
      )
        throw failure('tool_failed', 'invalid arguments: ' + call.name)
      const result = Promise.resolve().then(async () => {
        checkScope(context)
        const value = await tool.execute(input, context)
        const output = typeof value === 'string' ? value : JSON.stringify(value ?? null)
        if (output.length > maxOutput) throw failure('resource_exhausted', 'tool result exceeds budget')
        if (executions.get(key) === entry) {
          const released = maxOutput - output.length
          entry.retained -= released
          logSize -= released
        }
        return { type: 'function_call_output' as const, call_id: call.call_id, output }
      })
      const entry = { sessionId: context.sessionId, invocation, retained, result }
      logSize += retained
      executions.set(key, entry)
      return result
    },
  }
}

export function createAgent({ llm, tools, instructions, maxToolRounds }: AgentOptions): Agent {
  if (!Number.isInteger(maxToolRounds) || maxToolRounds < 0) throw RangeError('maxToolRounds')
  if (tools.definitions.length && !llm.capabilities.tools)
    throw failure('unsupported_capability', 'model does not accept tools')
  return {
    releaseSession(id) {
      tools.releaseSession?.(id)
    },
    async run(request, options): Promise<AgentResult> {
      const appended: InputItem[] = []
      try {
        for (let round = 0; ; round++) {
          checkScope(options)
          const response = await llm.createResponse(
            {
              input: [...request.input, ...appended],
              instructions,
              tools: tools.definitions,
              tool_choice: round === maxToolRounds && tools.definitions.length ? 'none' : undefined,
            },
            options,
          )
          checkScope(options)
          const calls = response.output.filter((item): item is FunctionCall => item.type === 'function_call')
          if (response.status === 'incomplete') {
            appended.push(...response.output.filter((item) => item.type === 'message'))
            return { status: 'incomplete', response, appended }
          }
          appended.push(...response.output)
          if (!calls.length) return { status: 'completed', response, appended }
          let problem: unknown = round >= maxToolRounds ? failure('resource_exhausted', 'tool round limit') : undefined
          for (const call of calls) {
            if (!problem) {
              try {
                const result = await tools.execute(call, {
                  signal: options.signal,
                  sessionId: request.sessionId,
                  turnId: request.turnId,
                  callId: call.call_id,
                })
                if (result.call_id !== call.call_id) throw failure('tool_failed', 'tool result ID mismatch')
                appended.push(result)
                continue
              } catch (error) {
                problem = (error as Partial<Failure>)?.code ? error : failure('tool_failed', String(error))
                appended.push({
                  type: 'function_call_output',
                  call_id: call.call_id,
                  output: '{"status":"failed","effect":"unknown"}',
                })
                continue
              }
            }
            appended.push({ type: 'function_call_output', call_id: call.call_id, output: '{"status":"not_executed"}' })
          }
          if (problem) throw problem
        }
      } catch (error) {
        const code = options.signal.aborted ? 'cancelled' : ((error as Partial<Failure>)?.code ?? 'provider_failed')
        return {
          status: code === 'cancelled' ? 'cancelled' : 'failed',
          error: { code, message: String(error) },
          appended,
        }
      }
    },
  }
}

export function adaptRobotCamera(camera: RobotCamera): Camera {
  return {
    async capture(options) {
      checkScope(options)
      const frame = await camera.capture({ width: options.width, height: options.height })
      if (!frame) throw failure('device_busy', 'camera has no frame')
      try {
        checkScope(options)
        if (frame.imageType === 'yuv422') throw failure('unsupported_capability', 'YUV422 camera format')
        const data = new Uint8Array(frame.buffer)
        const image =
          frame.imageType === 'jpeg'
            ? { format: frame.imageType, data }
            : { format: frame.imageType, width: frame.width, height: frame.height, data }
        return { image, capturedAtMs: Date.now(), release: () => frame.close?.() }
      } catch (error) {
        frame.close?.()
        throw error
      }
    },
  }
}

export function createVision({
  llm,
  camera,
  width = 176,
  height = 144,
}: VisionOptions & { width?: number; height?: number }): Vision {
  if (!llm.capabilities.image) throw failure('unsupported_capability', 'model does not accept images')
  let busy = false
  return {
    async observe({ question }, scope) {
      checkScope(scope)
      if (busy) throw failure('device_busy', 'observation already running')
      busy = true
      try {
        const frame = await camera.capture({ ...scope, width, height })
        try {
          checkScope(scope)
          const response = await llm.createResponse(
            {
              input: [
                {
                  type: 'message',
                  role: 'user',
                  content: [
                    { type: 'input_text', text: question },
                    { type: 'input_image', image: frame.image },
                  ],
                },
              ],
            },
            scope,
          )
          checkScope(scope)
          if (response.status !== 'completed') throw failure('provider_failed', 'incomplete observation')
          return { text: outputText(response), capturedAtMs: frame.capturedAtMs }
        } finally {
          frame.release()
        }
      } finally {
        busy = false
      }
    },
  }
}
