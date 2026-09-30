import { type ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/app/i18n-provider'
import { useProjectEditor } from './use-project-editor'
import { buildVisualProjectMod } from '@/services/mod-builder/mod-build-service'
import { installModToDevice, removeModFromDevice, DEVICE_OPERATION_STATUS } from '../../../editor/esptool-installer.mjs'

vi.mock('@/services/mod-builder/mod-build-service', () => ({ buildVisualProjectMod: vi.fn() }))
vi.mock('../../../editor/esptool-installer.mjs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../editor/esptool-installer.mjs')>()),
  installModToDevice: vi.fn(),
  removeModFromDevice: vi.fn(),
}))
function Wrapper({ children }: { children: ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>
}
const partition = { type: 1, subtype: 0, offset: 0x400000, size: 0x100000, label: 'xs' }
const detected = {
  chip: 'ESP32-S3',
  partition,
  appPartition: { ...partition, label: 'factory' },
  firmware: { version: '9.0.0', moddableVersion: '9.0.0', hostApiVersion: 1, projectName: 'stack-chan-host' },
}
beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  Object.defineProperty(navigator, 'serial', { configurable: true, value: { requestPort: vi.fn(async () => ({})) } })
  vi.mocked(buildVisualProjectMod).mockResolvedValue({
    archive: new Uint8Array([0, 0, 0, 8]),
    xsVersion: [17, 8, 0],
    elapsedMs: 1,
  })
})
afterEach(() => {
  Reflect.deleteProperty(navigator, 'serial')
})
async function setup() {
  const hook = renderHook(() => useProjectEditor(), { wrapper: Wrapper })
  await waitFor(() => expect(hook.result.current.project).not.toBeNull())
  act(() => {
    hook.result.current.setTarget('m5stackchan-cores3')
    hook.result.current.onWorkspaceChange({
      workspace: { blocks: { languageVersion: 0, blocks: [{ id: 'start', type: 'stackchan_on_start' }] } },
      source: 'export function onContextCreated() {}',
    })
  })
  await act(() => hook.result.current.build())
  return hook
}

describe('editor device operation results', () => {
  it('waits for confirmation before writing and returns the verified installation result', async () => {
    const write = vi.fn()
    vi.mocked(installModToDevice).mockImplementation(async (_loader, _port, _archive, options) => {
      if (!(await options!.onPreflight!(detected))) return { ...detected, status: DEVICE_OPERATION_STATUS.CANCELLED }
      write()
      return { ...detected, status: DEVICE_OPERATION_STATUS.INSTALLED, verified: true }
    })
    const { result } = await setup()
    const protect = vi.fn()
    let pending!: ReturnType<typeof result.current.installToDevice>
    act(() => {
      pending = result.current.installToDevice({ protect })
    })
    await waitFor(() => expect(result.current.confirmation).not.toBeNull())
    expect(write).not.toHaveBeenCalled()
    expect(protect).not.toHaveBeenCalled()
    await act(async () => {
      result.current.resolveConfirmation(true)
      expect(await pending).toMatchObject({ ok: true, verified: true })
    })
    expect(protect).toHaveBeenCalledOnce()
    expect(write).toHaveBeenCalledOnce()
  })

  it('rejects a changed project after confirmation and never writes it', async () => {
    const write = vi.fn()
    vi.mocked(installModToDevice).mockImplementation(async (_loader, _port, _archive, options) => {
      await options!.onPreflight!(detected)
      write()
      return { ...detected, status: DEVICE_OPERATION_STATUS.INSTALLED, verified: true }
    })
    const { result } = await setup()
    let pending!: ReturnType<typeof result.current.installToDevice>
    act(() => {
      pending = result.current.installToDevice()
    })
    await waitFor(() => expect(result.current.confirmation).not.toBeNull())
    act(() => result.current.setName('edited during confirmation'))
    await act(async () => {
      result.current.resolveConfirmation(true)
      expect(await pending).toMatchObject({ ok: false, code: 'revision_conflict' })
    })
    expect(write).not.toHaveBeenCalled()
  })

  it('cancels removal at confirmation and reports verification errors as failures', async () => {
    vi.mocked(removeModFromDevice).mockImplementation(async (_loader, _port, options) => {
      if (!(await options!.onPreflight!(detected))) return { ...detected, status: DEVICE_OPERATION_STATUS.CANCELLED }
      throw new Error('readback mismatch')
    })
    const { result } = await setup()
    const controller = new AbortController()
    let pending!: ReturnType<typeof result.current.removeFromDevice>
    act(() => {
      pending = result.current.removeFromDevice({ signal: controller.signal })
    })
    await waitFor(() => expect(result.current.confirmation).not.toBeNull())
    await act(async () => {
      controller.abort()
      expect(await pending).toMatchObject({ ok: false, code: 'cancelled' })
    })
    act(() => {
      pending = result.current.removeFromDevice()
    })
    await waitFor(() => expect(result.current.confirmation).not.toBeNull())
    await act(async () => {
      result.current.resolveConfirmation(true)
      expect(await pending).toMatchObject({ ok: false, code: 'device_failed' })
    })
    expect(result.current.deviceOperation.status).toBe('error')
  })
})
