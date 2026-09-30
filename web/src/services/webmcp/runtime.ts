import { z } from 'zod'

export class ToolError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
  }
}

export const emptyInput = z.object({}).strict()
export const expectedRevision = z.string().min(1)

// A document-local token also invalidates requests made before navigation.
export class Revision {
  private readonly session = crypto.randomUUID()
  private sequence = 0
  private previous = ''

  read(value: unknown) {
    const serialized = JSON.stringify(value)
    if (serialized !== this.previous) {
      this.previous = serialized
      this.sequence += 1
    }
    return `${this.session}:${this.sequence}`
  }

  check(expected: string, value: unknown) {
    if (this.read(value) !== expected) {
      throw new ToolError('revision_conflict', '内容が更新されています。現在の状態を取得してから変更してください。')
    }
  }
}

export type ToolDefinition = {
  name: string
  description: string
  schema: z.ZodType
  readOnly?: boolean
  untrusted?: boolean
  consequential?: boolean
  execute: (input: any, signal: AbortSignal) => unknown | Promise<unknown>
}

export type RegisteredTool = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean; consequentialHint: boolean }
  execute: (input: unknown, options?: { signal?: AbortSignal }) => Promise<unknown>
}

export type ModelContext = {
  registerTool: (tool: RegisteredTool, options: { signal: AbortSignal }) => void | Promise<void>
}

export function getModelContext(): ModelContext | undefined {
  const context = (document as Document & { modelContext?: ModelContext }).modelContext
  return typeof context?.registerTool === 'function' ? context : undefined
}

export function publicError(error: unknown) {
  if (error instanceof z.ZodError) {
    // Never return the input (in particular, passwords and tokens).
    return {
      code: 'invalid_input',
      message: '入力の形式を確認してください。',
      paths: error.issues.map((i) => i.path.join('.')),
    }
  }
  if (error instanceof ToolError) return { code: error.code, message: error.message }
  if (error !== null && typeof error === 'object' && 'name' in error && error.name === 'AbortError') {
    return { code: 'cancelled', message: '操作をキャンセルしました。' }
  }
  return { code: 'operation_failed', message: '操作に失敗しました。画面の状態を確認してください。' }
}

export async function registerTools(
  context: ModelContext | undefined,
  definitions: ToolDefinition[],
  signal: AbortSignal,
  latest: (name: string) => ToolDefinition | undefined = (name) => definitions.find((tool) => tool.name === name)
) {
  if (!context) return false
  const registration = new AbortController()
  const abort = () => registration.abort()
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
  try {
    for (const definition of definitions) {
      registration.signal.throwIfAborted()
      await context.registerTool(
        {
          name: definition.name,
          description: definition.description,
          inputSchema: z.toJSONSchema(definition.schema) as Record<string, unknown>,
          annotations: {
            readOnlyHint: definition.readOnly ?? false,
            untrustedContentHint: definition.untrusted ?? false,
            consequentialHint: definition.consequential ?? false,
          },
          async execute(input, options) {
            try {
              registration.signal.throwIfAborted()
              const tool = latest(definition.name)
              if (!tool) throw new ToolError('not_ready', 'この操作は現在利用できません。')
              const executionSignal = options?.signal ?? new AbortController().signal
              executionSignal.throwIfAborted()
              const data = await tool.execute(tool.schema.parse(input), executionSignal)
              return { ok: true, data }
            } catch (error) {
              return { ok: false, error: publicError(error) }
            }
          },
        },
        { signal: registration.signal }
      )
    }
    return true
  } catch (error) {
    registration.abort()
    signal.removeEventListener('abort', abort)
    throw error
  }
}

export type Operation = {
  id: string
  label: string
  status: 'waiting_user' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  cancellable: boolean
  actionLabel?: string
  result?: unknown
  error?: ReturnType<typeof publicError>
}
type TaskContext = {
  signal: AbortSignal
  protect: () => void
  waitForUser: <T>(promise: Promise<T>) => Promise<T>
}
type Task = (context: TaskContext) => unknown | Promise<unknown>

export class Operations {
  private records = new Map<string, Operation>()
  private tasks = new Map<string, { task: Task; controller: AbortController }>()
  private listeners = new Set<() => void>()
  private version = 0
  readonly registrations = new Map<string, 'registering' | 'ready' | 'error'>()
  readonly navigationGuards = new Set<() => void | Promise<void>>()
  registration(key: string, status?: 'registering' | 'ready' | 'error') {
    if (status) this.registrations.set(key, status)
    else this.registrations.delete(key)
    this.emit()
  }
  async beforeNavigate() {
    for (const guard of this.navigationGuards) await guard()
  }
  dispose() {
    for (const op of this.list()) if (op.cancellable) this.cancel(op.id)
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  snapshot = () => this.version
  private emit() {
    this.version += 1
    this.listeners.forEach((listener) => listener())
  }
  list = () => [...this.records.values()].map((record) => ({ ...record }))
  busy = () =>
    this.controllers.size > 0 || this.list().some((op) => op.status === 'running' || op.status === 'waiting_user')
  get(id: string) {
    const op = this.records.get(id)
    if (!op) throw new ToolError('not_found', '操作が見つかりません。')
    return { ...op }
  }
  start(label: string, task: Task, actionLabel?: string) {
    if (this.busy()) throw new ToolError('busy', '実行中の操作が終わってから再実行してください。')
    const id = crypto.randomUUID()
    const op: Operation = {
      id,
      label,
      status: actionLabel ? 'waiting_user' : 'running',
      cancellable: true,
      actionLabel,
    }
    this.records.set(id, op)
    this.tasks.set(id, { task, controller: new AbortController() })
    // Retain a bounded history; active operations are never evicted.
    if (this.records.size > 20) this.records.delete(this.records.keys().next().value!)
    this.emit()
    if (!actionLabel) void this.run(id)
    return this.get(id)
  }
  run = async (id: string) => {
    const op = this.records.get(id)
    const pending = this.tasks.get(id)
    if (!op || !pending) return
    this.tasks.delete(id)
    op.status = 'running'
    delete op.actionLabel
    // Keep the abort controller available while the task is running.
    this.controllers.set(id, pending.controller)
    this.emit()
    try {
      const result = await pending.task({
        signal: pending.controller.signal,
        protect: () => {
          pending.controller.signal.throwIfAborted()
          op.cancellable = false
          this.emit()
        },
        waitForUser: async (promise) => {
          op.status = 'waiting_user'
          this.emit()
          try {
            return await promise
          } finally {
            if (!pending.controller.signal.aborted) {
              op.status = 'running'
              this.emit()
            }
          }
        },
      })
      pending.controller.signal.throwIfAborted()
      op.result = result
      op.status = 'succeeded'
    } catch (error) {
      op.status =
        pending.controller.signal.aborted || (error instanceof ToolError && error.code === 'cancelled')
          ? 'cancelled'
          : 'failed'
      op.error = publicError(error)
    } finally {
      op.cancellable = false
      this.controllers.delete(id)
      this.emit()
    }
  }
  private controllers = new Map<string, AbortController>()
  cancel(id: string) {
    const op = this.records.get(id)
    if (!op) throw new ToolError('not_found', '操作が見つかりません。')
    if (!op.cancellable) throw new ToolError('cannot_cancel', 'この操作は現在キャンセルできません。')
    this.tasks.get(id)?.controller.abort()
    this.controllers.get(id)?.abort()
    this.tasks.delete(id)
    op.status = 'cancelled'
    op.cancellable = false
    this.emit()
    return this.get(id)
  }
}
