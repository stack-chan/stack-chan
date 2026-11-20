import { type ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/app/i18n-provider'
import { createFaceAsset } from '../../../editor/face-assets.mjs'
import { MAX_ASSET_COUNT } from '../../../editor/project-format.mjs'
import { type VisualProject } from './project-types'
import { useProjectEditor } from './use-project-editor'

type State = { currentProject: VisualProject; projects: VisualProject[] }
const storage = vi.hoisted(() => ({
  kind: 'indexedDB',
  loadState: vi.fn<() => Promise<State | null>>(),
  loadRecovery: async () => null,
  saveState: vi.fn<(state: State) => Promise<void>>(),
}))
vi.mock('../../../editor/project-storage.mjs', () => ({ createProjectStorage: () => storage }))

function Wrapper({ children }: { children: ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>
}

function asset(name: string, text: string) {
  const bytes = new TextEncoder().encode(text)
  return { name, type: 'text/plain', size: bytes.length, arrayBuffer: async () => bytes.buffer } as File
}

function heldAsset(name: string, text: string) {
  let release!: () => void
  let onRead!: () => void
  const entered = new Promise<void>((resolve) => {
    onRead = resolve
  })
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  const file = asset(name, text)
  const bytes = file.arrayBuffer
  file.arrayBuffer = async () => {
    onRead()
    await pending
    return bytes()
  }
  return { entered, release, file }
}

const paths = (project: VisualProject | null) => project?.assets.map(({ path }) => path)

beforeEach(() => {
  localStorage.clear()
  storage.loadState.mockReset().mockResolvedValue(null)
  storage.saveState.mockReset().mockResolvedValue(undefined)
})

async function editorWithProject() {
  const hook = renderHook(useProjectEditor, { wrapper: Wrapper })
  await waitFor(() => expect(hook.result.current.project).not.toBeNull())
  const add = async (...files: File[]) => {
    await act(async () => hook.result.current.addAssets(files))
  }
  const start = async (held: ReturnType<typeof heldAsset>) => {
    let saving!: Promise<void>
    act(() => {
      saving = hook.result.current.addAssets([held.file])
    })
    await held.entered
    return async () => {
      await act(async () => {
        held.release()
        await saving
      })
    }
  }
  return { ...hook, add, start }
}

it.each(['switch', 'switch back', 'reopen'] as const)('does not commit a stale asset read after %s', async (mode) => {
  const { result, add, start, unmount } = await editorWithProject()
  await add(asset('a.txt', 'original A'))
  const a = result.current.project!
  act(() => result.current.newProject())
  await add(asset('b.txt', 'original B'))
  const b = result.current.project!
  expect(a.id).not.toBe(b.id)
  act(() => result.current.loadProject(a))

  const finish = await start(heldAsset('from-a.txt', 'delayed'))
  if (mode !== 'reopen') act(() => result.current.loadProject(b))
  if (mode !== 'switch') act(() => result.current.loadProject(a))
  await finish()
  const expected = mode === 'switch' ? b : a
  expect(result.current.project?.id).toBe(expected.id)
  expect(result.current.project?.assets).toEqual(expected.assets)
  expect(result.current.projects.find(({ id }) => id === a.id)?.assets).toEqual(a.assets)
  expect(result.current.projects.find(({ id }) => id === b.id)?.assets).toEqual(b.assets)

  unmount()
  await waitFor(() => expect(storage.saveState).toHaveBeenCalled())
  const committed = storage.saveState.mock.lastCall?.[0]
  expect(committed?.currentProject.assets).toEqual(expected.assets)
})

it('combines overlapping additions in one open project and preserves intervening settings and removals', async () => {
  const { result, add, start } = await editorWithProject()
  await add(asset('removed.txt', 'remove me'))
  const initialEmbed = result.current.project!.settings.embedAssets
  const finish = await start(heldAsset('slow.txt', 'slow'))
  await add(asset('fast.txt', 'fast'))
  act(() => {
    result.current.setEmbedAssets(!initialEmbed)
    result.current.removeAsset('assets/removed.txt')
  })
  await finish()
  expect(paths(result.current.project)).toEqual(['assets/fast.txt', 'assets/slow.txt'])
  expect(result.current.project!.settings.embedAssets).toBe(!initialEmbed)
})

it('does not reinsert an asset removed while its replacement was being read', async () => {
  const { result, add, start } = await editorWithProject()
  await add(asset('same.txt', 'old'))
  const finish = await start(heldAsset('same.txt', 'replacement'))
  act(() => result.current.removeAsset('assets/same.txt'))
  await finish()
  expect(paths(result.current.project)).toEqual([])
})

it('keeps the latest file selected when two reads target the same path', async () => {
  const { result, add, start } = await editorWithProject()
  const finish = await start(heldAsset('same.txt', 'first'))
  await add(asset('same.txt', 'second'))
  const selected = result.current.project!.assets
  expect(paths(result.current.project)).toEqual(['assets/same.txt'])
  await finish()
  expect(result.current.project?.assets).toEqual(selected)
})

it('allows a replacement at capacity but does not exceed capacity when another read completes first', async () => {
  const { result, add, start } = await editorWithProject()
  await add(...Array.from({ length: MAX_ASSET_COUNT - 1 }, (_, index) => asset(`asset-${index}.txt`, 'old')))
  const finish = await start(heldAsset('slow-new.txt', 'slow'))
  await add(asset('fast-new.txt', 'fast'))
  await finish()
  expect(paths(result.current.project)).toHaveLength(MAX_ASSET_COUNT)
  expect(paths(result.current.project)).toContain('assets/fast-new.txt')
  expect(paths(result.current.project)).not.toContain('assets/slow-new.txt')
  await add(asset('asset-0.txt', 'replacement'))
  expect(paths(result.current.project)).toHaveLength(MAX_ASSET_COUNT)
  expect(atob(result.current.project!.assets.find(({ path }) => path === 'assets/asset-0.txt')!.data)).toBe(
    'replacement'
  )
})

it('keeps an explicit Face selection made while another Face is being read', async () => {
  const { result, add, start } = await editorWithProject()
  const face = (name: string) => JSON.stringify(createFaceAsset({ name }))
  await add(asset('original.stackchan-face.json', face('Original')))
  expect(result.current.project!.settings.faceAsset).toBe('assets/original.stackchan-face.json')
  const finish = await start(heldAsset('other.stackchan-face.json', face('Other')))
  act(() => result.current.selectFace(null))
  await finish()
  expect(paths(result.current.project)).toContain('assets/other.stackchan-face.json')
  expect(result.current.project!.settings.faceAsset).toBeNull()
})

it('reports invalid files in the active project but ignores stale read failures after reopening', async () => {
  const { result, add } = await editorWithProject()
  await add(asset('invalid.stackchan-face.json', 'not JSON'))
  expect(paths(result.current.project)).toEqual([])
  expect(result.current.logs.some(({ message }) => message.includes('invalid.stackchan-face.json'))).toBe(true)
  const original = result.current.project!
  let fail!: (reason: Error) => void
  const pending = new Promise<ArrayBuffer>((_, reject) => {
    fail = reject
  })
  let reading!: Promise<void>
  act(() => {
    reading = result.current.addAssets([
      {
        name: 'stale.txt',
        type: 'text/plain',
        size: 1,
        arrayBuffer: () => pending,
      } as File,
    ])
  })
  act(() => result.current.loadProject(original))
  await act(async () => {
    fail(new Error('read failed'))
    await reading
  })
  expect(result.current.logs.some(({ message }) => message.includes('stale.txt'))).toBe(false)
  await add(asset('valid.txt', 'next'))
  expect(paths(result.current.project)).toEqual(['assets/valid.txt'])
})

it('finishes other files in a batch when a read for a superseded path rejects', async () => {
  const { result, add } = await editorWithProject()
  let fail!: (reason: Error) => void
  const pending = new Promise<ArrayBuffer>((_, reject) => {
    fail = reject
  })
  let reading!: Promise<void>
  act(() => {
    const obsolete = { name: 'same.txt', type: 'text/plain', size: 1, arrayBuffer: () => pending } as File
    reading = result.current.addAssets([obsolete, asset('other.txt', 'other')])
  })
  await add(asset('same.txt', 'newest'))
  await act(async () => {
    fail(new Error('obsolete read'))
    await reading
  })
  expect(paths(result.current.project)).toEqual(['assets/same.txt', 'assets/other.txt'])
  expect(result.current.logs.some(({ message }) => message.includes('obsolete read'))).toBe(false)
})

it('does not read a new asset if the open project already has no free slot', async () => {
  const { result, add } = await editorWithProject()
  await add(...Array.from({ length: MAX_ASSET_COUNT }, (_, index) => asset(`asset-${index}.txt`, 'old')))
  const excess = asset('excess.txt', 'excess')
  const read = vi.spyOn(excess, 'arrayBuffer')
  await add(excess)
  expect(read).not.toHaveBeenCalled()
  expect(paths(result.current.project)).toHaveLength(MAX_ASSET_COUNT)
  expect(paths(result.current.project)).not.toContain('assets/excess.txt')
})
