import { type ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/app/i18n-provider'
import { useProjectEditor } from './use-project-editor'
import { type VisualProject } from './project-types'

const storage = vi.hoisted(() => ({
  kind: 'indexedDB',
  loadState: vi.fn(),
  loadRecovery: vi.fn(async () => null),
  saveState: vi.fn(),
}))
vi.mock('../../../editor/project-storage.mjs', () => ({ createProjectStorage: () => storage }))

function Wrapper({ children }: { children: ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>
}

beforeEach(() => {
  localStorage.clear()
  storage.loadState.mockResolvedValue(null)
  storage.saveState.mockResolvedValue(undefined)
  storage.saveState.mockClear()
})
afterEach(() => vi.useRealTimers())

describe('project editor persistence', () => {
  it('coalesces repeated edits without a localStorage mirror and restores all recent projects', async () => {
    const { result, unmount } = renderHook(() => useProjectEditor(), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.project).not.toBeNull())
    vi.useFakeTimers()
    const localWrite = vi.spyOn(Storage.prototype, 'setItem')
    const firstId = result.current.project!.id
    act(() => {
      for (let i = 0; i < 100; i++) result.current.setName(`edit ${i}`)
      result.current.newProject()
      result.current.setName('second')
    })
    expect(storage.saveState).not.toHaveBeenCalled()
    expect(localWrite).not.toHaveBeenCalled()
    unmount()
    await act(async () => {
      await Promise.resolve()
    })
    expect(storage.saveState).toHaveBeenCalledOnce()
    const saved = storage.saveState.mock.calls[0][0]
    expect(saved.currentProject.name).toBe('second')
    expect(saved.projects.find((project: VisualProject) => project.id === firstId).name).toBe('edit 99')
    storage.loadState.mockResolvedValue(structuredClone(saved))
    vi.useRealTimers()
    const restored = renderHook(() => useProjectEditor(), { wrapper: Wrapper })
    await waitFor(() => expect(restored.result.current.project?.name).toBe('second'))
    expect(restored.result.current.projects).toHaveLength(2)
  })

  it('guards navigation until the latest write commits and flushes when hidden', async () => {
    const { result } = renderHook(() => useProjectEditor(), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.project).not.toBeNull())
    let finish!: () => void
    storage.saveState.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    act(() => result.current.setName('pending'))
    const leaving = new Event('beforeunload', { cancelable: true })
    act(() => {
      window.dispatchEvent(leaving)
    })
    expect(leaving.defaultPrevented).toBe(true)
    expect(storage.saveState).toHaveBeenCalledOnce()
    act(() => result.current.setName('latest'))
    await act(async () => {
      finish()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(storage.saveState).toHaveBeenLastCalledWith(
      expect.objectContaining({ currentProject: expect.objectContaining({ name: 'latest' }) })
    )
    const savedLeaving = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(savedLeaving)
    expect(savedLeaving.defaultPrevented).toBe(false)
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    act(() => {
      result.current.setName('hidden')
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(storage.saveState).toHaveBeenLastCalledWith(
      expect.objectContaining({ currentProject: expect.objectContaining({ name: 'hidden' }) })
    )
  })
})
