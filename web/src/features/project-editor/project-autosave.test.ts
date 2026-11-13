import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProjectAutosave } from './project-autosave'

afterEach(() => vi.useRealTimers())

describe('project autosave', () => {
  it('coalesces a burst before serialization and retains the latest state during a slow save', async () => {
    vi.useFakeTimers()
    let finish!: () => void
    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve
          })
      )
      .mockResolvedValue(undefined)
    const autosave = createProjectAutosave(save, vi.fn())
    for (let i = 0; i < 100; i++) autosave.submit({ revision: i })
    expect(save).not.toHaveBeenCalled()
    vi.runOnlyPendingTimers()
    expect(save).toHaveBeenCalledExactlyOnceWith({ revision: 99 })
    for (let i = 100; i < 200; i++) autosave.submit({ revision: i })
    expect(autosave.pending).toBe(true)
    finish()
    await autosave.flush()
    expect(save).toHaveBeenNthCalledWith(2, { revision: 199 })
    expect(save).toHaveBeenCalledTimes(2)
    expect(autosave.pending).toBe(false)
  })

  it('keeps failed writes pending and retries on flush without losing the last edit', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('quota')).mockResolvedValue(undefined)
    const onError = vi.fn()
    const autosave = createProjectAutosave(save, onError)
    autosave.submit('latest')
    await autosave.flush()
    expect(autosave.pending).toBe(true)
    expect(onError).toHaveBeenCalledOnce()
    await autosave.flush()
    expect(save).toHaveBeenNthCalledWith(2, 'latest')
    expect(autosave.pending).toBe(false)
  })
})
