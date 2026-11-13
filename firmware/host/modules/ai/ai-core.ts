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
  return {
    async run(request, scope) {
      checkScope(scope)
      const result = await agent.run(request, scope)
      checkScope(scope)
      if ('error' in result) throw failure(result.error.code, result.error.message)
      if (result.status !== 'completed') throw failure('provider_failed', 'incomplete delegated response')
      return result.response.output.filter((item) => item.type === 'message' && item.phase !== 'commentary')
    },
  }
}

export type Tool = {
  definition: FunctionDefinition
  execute(input: Record<string, Json>, context: ToolContext): unknown | Promise<unknown>
  validate?(input: Record<string, Json>): boolean
}

export async function toolsFromMCP(
  client: {
    listTools(): Promise<{
      tools: readonly { name: string; description?: string; inputSchema: FunctionDefinition['parameters'] }[]
    }>
    callTool(name: string, input: Record<string, Json>, scope?: Scope): Promise<unknown>
  },
  options: { validators?: Readonly<Record<string, NonNullable<Tool['validate']>>> } = {},
): Promise<Tool[]> {
  return (await client.listTools()).tools.map(({ name, description, inputSchema }) => {
    const validator = Object.hasOwn(options.validators ?? {}, name) ? options.validators?.[name] : undefined
    try {
      checkSchema(inputSchema, Boolean(validator))
    } catch (error) {
      throw failure('unsupported_capability', `MCP tool ${name}: ${String(error)}`)
    }
    return {
      definition: { type: 'function', name, description: description ?? name, parameters: inputSchema, strict: false },
      validate: validator,
      execute: (input, context) => client.callTool(name, input, { signal: context.signal }),
    }
  })
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

function copyForJSON(value: object): object {
  const copies = new Map<object, object>()
  const pending: object[] = []
  const allocate = (source: object) => {
    const target = Array.isArray(source) ? new Array(source.length) : Object.create(null)
    copies.set(source, target)
    pending.push(source)
    return target
  }
  const result = allocate(value)
  for (let index = 0; index < pending.length; index++) {
    const source = pending[index]
    const target = copies.get(source) as Record<string, unknown>
    for (const key of Object.keys(source)) {
      const child = (source as Record<string, unknown>)[key]
      target[key] = child && typeof child === 'object' ? (copies.get(child) ?? allocate(child)) : child
    }
  }
  return result
}

function toolOutput(value: unknown, maxChars: number): string {
  const exceeded = () => failure('resource_exhausted', 'tool result exceeds budget')
  if (typeof value === 'string') {
    if (value.length > maxChars) throw exceeded()
    return value
  }
  let output = '',
    visits = 0
  const ancestors = new Set<object>()
  const append = (text: string) => {
    if (text.length > maxChars - output.length) throw exceeded()
    output += text
  }
  const quote = (text: string) => {
    const available = maxChars - output.length
    if (text.length + 2 > available) throw exceeded()
    let length = 2
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i)
      if (code === 34 || code === 92 || code === 8 || code === 9 || code === 10 || code === 12 || code === 13)
        length += 2
      else if (code < 32) length += 6
      else if (
        code >= 0xd800 &&
        code <= 0xdbff &&
        text.charCodeAt(i + 1) >= 0xdc00 &&
        text.charCodeAt(i + 1) <= 0xdfff
      ) {
        length += 2
        i++
      } else if (code >= 0xd800 && code <= 0xdfff) length += 6
      else length++
      if (length > available) throw exceeded()
    }
    append(JSON.stringify(text))
  }
  const prepare = (item: unknown, key: string): unknown => {
    if (++visits > maxChars) throw exceeded()
    if (item && (typeof item === 'object' || typeof item === 'bigint')) {
      const toJSON = (item as { toJSON?: unknown }).toJSON
      if (typeof toJSON === 'function') item = toJSON.call(item, key)
    }
    if (item instanceof Number || item instanceof String || item instanceof Boolean || item instanceof BigInt)
      item = item.valueOf()
    return item
  }
  const omitted = (item: unknown) => item === undefined || typeof item === 'function' || typeof item === 'symbol'
  const write = (item: unknown, depth: number) => {
    if (depth > 40) throw exceeded()
    if (typeof item === 'string') quote(item)
    else if (item === null || typeof item === 'number' || typeof item === 'boolean') append(JSON.stringify(item))
    else if (item && typeof item === 'object') {
      if (ancestors.has(item)) throw failure('tool_failed', 'circular tool result')
      ancestors.add(item)
      if (Array.isArray(item)) {
        append('[')
        const length = item.length
        for (let i = 0; i < length; i++) {
          if (i) append(',')
          const child = prepare(item[i], String(i))
          write(omitted(child) ? null : child, depth + 1)
        }
        append(']')
      } else {
        append('{')
        let first = true
        for (const key in item) {
          if (!Object.hasOwn(item, key)) continue
          const child = prepare((item as Record<string, unknown>)[key], key)
          if (omitted(child)) continue
          if (!first) append(',')
          first = false
          quote(key)
          append(':')
          write(child, depth + 1)
        }
        append('}')
      }
      ancestors.delete(item)
    } else throw failure('tool_failed', 'tool result is not JSON serializable')
  }
  write(prepare(value ?? null, ''), 0)
  return output
}

export function createToolSet(tools: readonly Tool[] = [], options: { maxOutputChars?: number } = {}): ToolSet {
  const maxOutput = options.maxOutputChars ?? 4096
  if (!Number.isSafeInteger(maxOutput) || maxOutput < 1) throw RangeError('invalid tool budget')
  const byName = new Map<string, Tool>()
  let unconfirmed = 0
  for (const tool of tools) {
    checkSchema(tool.definition.parameters, Boolean(tool.validate))
    if (byName.has(tool.definition.name)) throw Error('duplicate tool: ' + tool.definition.name)
    // XSのJSON.stringifyはpreloadされたROM配列を走査できないため、参照をRAMへ写す
    const definition = freezeTree(JSON.parse(JSON.stringify(copyForJSON(tool.definition))))
    byName.set(tool.definition.name, { ...tool, definition })
  }
  return {
    definitions: Object.freeze([...byName.values()].map((tool) => tool.definition)),
    async execute(call, context) {
      checkScope(context)
      if (unconfirmed) throw failure('cancelled_unconfirmed', 'previous tool effect is still pending')
      if (
        call.arguments.length > 8192 ||
        call.name.length > 128 ||
        call.call_id.length > 256 ||
        context.callId !== call.call_id
      )
        throw failure('tool_failed', 'invalid tool call identifier or argument size')
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
      checkScope(context)
      let value = tool.execute(input, context)
      if (value && typeof (value as PromiseLike<unknown>).then === 'function') {
        const pending = value
        let settled = false,
          abandoned = false
        let onAbort = () => {}
        value = await new Promise<unknown>((resolve, reject) => {
          onAbort = () => {
            if (settled || abandoned) return
            abandoned = true
            unconfirmed++
            reject(failure('cancelled_unconfirmed', 'tool wait cancelled; effect may continue'))
          }
          context.signal.addEventListener('abort', onAbort)
          const finish = () => {
            settled = true
            if (abandoned) unconfirmed--
          }
          Promise.resolve(pending).then(
            (result) => {
              finish()
              resolve(result)
            },
            (error) => {
              finish()
              reject(error)
            },
          )
          if (context.signal.aborted) onAbort()
        }).finally(() => context.signal.removeEventListener('abort', onAbort))
      }
      const output = toolOutput(value, maxOutput)
      return { type: 'function_call_output', call_id: call.call_id, output }
    },
  }
}

export function createAgent({ llm, tools, instructions, maxToolRounds }: AgentOptions): Agent {
  if (!Number.isInteger(maxToolRounds) || maxToolRounds < 0) throw RangeError('maxToolRounds')
  if (tools.definitions.length && !llm.capabilities.tools)
    throw failure('unsupported_capability', 'model does not accept tools')
  return {
    capabilities: { image: llm.capabilities.image },
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
        const reason = (error as Partial<Failure>)?.code
        const code =
          reason === 'cancelled_unconfirmed'
            ? reason
            : options.signal.aborted
              ? 'cancelled'
              : (reason ?? 'provider_failed')
        return {
          status: code === 'cancelled' || code === 'cancelled_unconfirmed' ? 'cancelled' : 'failed',
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
