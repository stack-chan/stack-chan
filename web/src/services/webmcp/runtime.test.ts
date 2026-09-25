import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  emptyInput,
  Operations,
  publicError,
  registerTools,
  Revision,
  type RegisteredTool,
  type ToolDefinition,
} from './runtime'

describe('WebMCP runtime', () => {
  it('works without browser support and unregisters only its own tools', async () => {
    const controller = new AbortController()
    const tools = new Map<string, RegisteredTool>()
    const definition = { name: 'test.read', description: 'Read', schema: emptyInput, readOnly: true, execute: () => 1 }
    expect(await registerTools(undefined, [definition], controller.signal)).toBe(false)
    await registerTools(
      {
        registerTool(tool, { signal }) {
          tools.set(tool.name, tool)
          signal.addEventListener('abort', () => tools.delete(tool.name))
        },
      },
      [definition],
      controller.signal
    )
    expect(await tools.get('test.read')!.execute({})).toEqual({ ok: true, data: 1 })
    const registered = tools.get('test.read')!
    controller.abort()
    expect(tools.size).toBe(0)
    expect(await registered.execute({})).toMatchObject({ ok: false, error: { code: 'cancelled' } })
  })

  it('uses the latest handler and validates inputs without echoing secrets', async () => {
    let tool!: RegisteredTool
    let value = 1
    const execute = vi.fn(() => value)
    const definition: ToolDefinition = {
      name: 'test.write',
      description: 'Write',
      schema: z.object({ secret: z.string() }).strict(),
      execute,
    }
    await registerTools(
      {
        registerTool: (registered) => {
          tool = registered
        },
      },
      [definition],
      new AbortController().signal
    )
    value = 2
    expect(await tool.execute({ secret: 'secret-test-value' })).toEqual({ ok: true, data: 2 })
    const result = await tool.execute({ secret: { password: 'secret-test-value' } })
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_input', paths: ['secret'] } })
    expect(JSON.stringify(result)).not.toContain('secret-test-value')
    expect(execute).toHaveBeenCalledOnce()
    expect(publicError(new Error('secret-test-value'))).not.toHaveProperty('message', 'secret-test-value')
  })

  it('rolls back partial registration on failure', async () => {
    const tools = new Map<string, RegisteredTool>()
    await expect(
      registerTools(
        {
          registerTool(tool, { signal }) {
            if (tools.size) throw new Error('registration failed')
            tools.set(tool.name, tool)
            signal.addEventListener('abort', () => tools.delete(tool.name))
          },
        },
        ['first', 'second'].map((name) => ({ name, description: name, schema: emptyInput, execute: () => null })),
        new AbortController().signal
      )
    ).rejects.toThrow()
    expect(tools.size).toBe(0)
  })

  it('rejects stale state and tokens from another document', () => {
    const revision = new Revision()
    const token = revision.read({ value: 1 })
    expect(() => revision.check(token, { value: 1 })).not.toThrow()
    expect(() => revision.check(token, { value: 2 })).toThrow()
    expect(() => new Revision().check(token, { value: 1 })).toThrow()
  })

  it('requires user action before starting and prevents cancelling a protected write', async () => {
    const operations = new Operations()
    let finish!: () => void
    const task = vi.fn(async ({ protect }) => {
      protect()
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      return { verified: true }
    })
    const operation = operations.start('Write', task, 'Select device')
    expect(operation.status).toBe('waiting_user')
    expect(task).not.toHaveBeenCalled()
    expect(() => operations.start('Duplicate', task)).toThrow()
    const run = operations.run(operation.id)
    expect(() => operations.cancel(operation.id)).toThrow()
    finish()
    await run
    expect(operations.get(operation.id)).toMatchObject({ status: 'succeeded', result: { verified: true } })
  })

  it('never starts a cancelled pending task', async () => {
    const operations = new Operations()
    const task = vi.fn()
    const operation = operations.start('Write', task, 'Select')
    operations.cancel(operation.id)
    await operations.run(operation.id)
    expect(task).not.toHaveBeenCalled()
    expect(operations.get(operation.id).status).toBe('cancelled')
  })
})
