import { type ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/app/i18n-provider'
import { type VisualProject } from '@/features/project-editor/project-types'
import { useProjectEditor } from '@/features/project-editor/use-project-editor'
import { buildVisualProjectMod, type ModBuildResult } from '@/services/mod-builder/mod-build-service'

vi.mock('@/services/mod-builder/mod-build-service', () => ({
  buildVisualProjectMod: vi.fn(),
}))

const workspaceSnapshot = (source: string) => ({
  workspace: {
    blocks: {
      languageVersion: 0,
      blocks: [{ id: 'start', type: 'stackchan_on_start' }],
    },
  },
  source,
})

const buildResult: ModBuildResult = {
  archive: new Uint8Array([0, 0, 0, 8]),
  xsVersion: [17, 8, 0],
  elapsedMs: 100,
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve
  })
  return { promise, resolve }
}

function TestProvider({ children }: { children: ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>
}

const invalidationScenarios: Array<{
  name: string
  invalidate: (editor: ReturnType<typeof useProjectEditor>) => void | Promise<void>
}> = [
  {
    name: 'the workspace changes',
    invalidate: (editor) => editor.onWorkspaceChange(workspaceSnapshot('const changed = true')),
  },
  {
    name: 'the target changes',
    invalidate: (editor) => editor.setTarget('simulator'),
  },
  {
    name: 'the project name changes',
    invalidate: (editor) => editor.setName('Renamed project'),
  },
  {
    name: 'the embedded assets change',
    invalidate: (editor) =>
      editor.addAssets([
        {
          name: 'asset.txt',
          type: 'text/plain',
          size: 5,
          arrayBuffer: async () => new TextEncoder().encode('asset').buffer,
        } as File,
      ]),
  },
  {
    name: 'another project is selected',
    invalidate: (editor) => {
      const current = editor.project
      if (!current) throw new Error('project is not loaded')
      const next: VisualProject = {
        ...structuredClone(current),
        id: 'another-project',
        name: 'Another project',
      }
      editor.loadProject(next)
    },
  },
]

describe('useProjectEditor build invalidation', () => {
  beforeEach(() => {
    localStorage.removeItem('stackchan-visual-project-v1')
    vi.mocked(buildVisualProjectMod).mockReset()
  })

  it.each(invalidationScenarios)('discards an in-flight build result when $name', async ({ invalidate }) => {
    const pendingBuild = deferred<ModBuildResult>()
    vi.mocked(buildVisualProjectMod).mockReturnValueOnce(pendingBuild.promise)
    const { result } = renderHook(() => useProjectEditor(), { wrapper: TestProvider })

    await waitFor(() => expect(result.current.project).not.toBeNull())
    act(() => result.current.onWorkspaceChange(workspaceSnapshot('const initial = true')))
    await waitFor(() => expect(result.current.analysis.canBuild).toBe(true))

    let buildPromise!: Promise<void>
    act(() => {
      buildPromise = result.current.build()
    })
    await waitFor(() => expect(result.current.buildOperation.status).toBe('pending'))

    await act(async () => {
      await invalidate(result.current)
    })
    expect(result.current.archive).toBeNull()
    expect(result.current.buildOperation.status).toBe('idle')

    await act(async () => {
      pendingBuild.resolve(buildResult)
      await buildPromise
    })

    expect(result.current.archive).toBeNull()
    expect(result.current.buildOperation.status).toBe('idle')
  })
})
