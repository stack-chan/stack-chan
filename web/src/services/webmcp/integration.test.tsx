import { StrictMode, type ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/app/i18n-provider'
import { useFaceEditor } from '@/features/face-editor/use-face-editor'
import { useFaceTools } from '@/features/face-editor/face-tools'
import { usePreferences } from '@/features/preferences/use-preferences'
import { usePreferenceTools } from '@/features/preferences/preference-tools'
import type { PreferenceClient, PreferenceValue } from '@/services/preferences/ble-preference-client'
import { WebMcpProvider, useOperations } from './react'
import type { RegisteredTool } from './runtime'

const tools = new Map<string, RegisteredTool>()
function Wrapper({ children }: { children: ReactNode }) {
  return (
    <StrictMode>
      <I18nProvider>
        <WebMcpProvider>{children}</WebMcpProvider>
      </I18nProvider>
    </StrictMode>
  )
}
beforeEach(() => {
  localStorage.clear()
  tools.clear()
  Object.defineProperty(document, 'modelContext', {
    configurable: true,
    value: {
      registerTool(tool: RegisteredTool, { signal }: { signal: AbortSignal }) {
        if (tools.has(tool.name)) throw new Error('duplicate registration')
        tools.set(tool.name, tool)
        signal.addEventListener('abort', () => tools.delete(tool.name), { once: true })
      },
    },
  })
})
afterEach(() => {
  Reflect.deleteProperty(document, 'modelContext')
})
async function call(name: string, input = {}) {
  let value: any
  await act(async () => {
    value = await tools.get(name)!.execute(input)
  })
  return value
}

describe('registered app tools', () => {
  it('edits the actual face, rejects stale revisions and unregisters on unmount in StrictMode', async () => {
    const { result, unmount } = renderHook(
      () => {
        const editor = useFaceEditor()
        useFaceTools(editor)
        return editor
      },
      { wrapper: Wrapper }
    )
    await waitFor(() => expect(tools.size).toBe(5))
    const before = await call('stackchan.face.get')
    const updated = await call('stackchan.face.update', {
      expectedRevision: before.data.revision,
      changes: { name: '丸い目', shape: { eyes: { left: { shape: 'circle', radius: 12 } } } },
    })
    expect(updated.ok).toBe(true)
    expect(result.current.asset.name).toBe('丸い目')
    expect(updated.data.asset).toEqual(result.current.asset)
    expect(
      (await call('stackchan.face.update', { expectedRevision: before.data.revision, changes: { name: 'stale' } }))
        .error.code
    ).toBe('revision_conflict')
    act(() =>
      result.current.update((face) => {
        face.name = 'manual change'
      })
    )
    expect((await call('stackchan.face.get')).data.asset.name).toBe('manual change')
    const exported = await call('stackchan.face.export')
    expect(JSON.parse(exported.data.json)).toEqual(result.current.asset)
    unmount()
    expect(tools.size).toBe(0)
  })

  it('redacts all secrets, validates a whole settings batch, and confirms Wi-Fi clearing', async () => {
    let connected = false
    let notify!: (value: PreferenceValue) => void
    let confirm!: (value: boolean) => void
    const send = vi.fn(async () => {})
    const client: PreferenceClient = {
      connect: async () => {
        connected = true
      },
      disconnect: async () => {
        connected = false
      },
      isConnected: () => connected,
      send,
    }
    const { result } = renderHook(
      () => {
        const preferences = usePreferences((onValue) => {
          notify = onValue
          return client
        })
        const operations = useOperations()
        usePreferenceTools(
          preferences,
          () =>
            new Promise<boolean>((resolve) => {
              confirm = resolve
            })
        )
        return { preferences, operations }
      },
      { wrapper: Wrapper }
    )
    await waitFor(() => expect(tools.size).toBe(7))
    const connection = await call('stackchan.preferences.request_connect')
    expect(connected).toBe(false)
    await act(() => result.current.operations.run(connection.data.id))
    act(() => {
      for (const prop of ['wifi.password', 'tts.token', 'ai.token', 'mcp.token'])
        notify({ prop, value: 'never-expose-this-value' })
      notify({ prop: 'driver.type', value: 'm5stackchan', readOnly: true })
    })
    const before = await call('stackchan.preferences.get')
    expect(JSON.stringify(before)).not.toContain('never-expose-this-value')
    expect(before.data.fields['mcp.token']).toMatchObject({ secret: true, hasValue: true, deviceHasValue: true })
    const invalid = await call('stackchan.preferences.update', {
      expectedRevision: before.data.revision,
      changes: { 'wifi.ssid': 'changed', 'tts.volume': '999' },
    })
    expect(invalid.error.code).toBe('invalid_input')
    expect(result.current.preferences.values['wifi.ssid']).toBe('')
    expect(
      (
        await call('stackchan.preferences.update', {
          expectedRevision: before.data.revision,
          changes: { 'driver.type': 'none' },
        })
      ).error.code
    ).toBe('read_only')
    const updated = await call('stackchan.preferences.update', {
      expectedRevision: before.data.revision,
      changes: { 'wifi.ssid': 'test', 'mcp.token': 'a-new-secret' },
    })
    expect(JSON.stringify(updated)).not.toContain('a-new-secret')
    const save = await call('stackchan.preferences.save', { expectedRevision: updated.data.revision })
    await waitFor(() => expect(result.current.operations.get(save.data.id).status).toBe('succeeded'))
    expect(result.current.operations.get(save.data.id).result).toMatchObject({ status: 'sent', confirmedKeys: [] })
    expect(send).toHaveBeenCalledWith({ _batch: { 'wifi.ssid': 'test', 'mcp.token': 'a-new-secret' } })
    const current = await call('stackchan.preferences.get')
    const clear = await call('stackchan.preferences.request_clear_wifi', { expectedRevision: current.data.revision })
    expect(send).toHaveBeenCalledTimes(1)
    await act(async () => {
      confirm(false)
    })
    expect(result.current.operations.get(clear.data.id).status).toBe('cancelled')
    const clearAgain = await call('stackchan.preferences.request_clear_wifi', {
      expectedRevision: current.data.revision,
    })
    await act(async () => {
      confirm(true)
    })
    expect(result.current.operations.get(clearAgain.data.id).status).toBe('succeeded')
    expect(send).toHaveBeenLastCalledWith({ _batch: { 'wifi.ssid': '', 'wifi.password': '' } })
  })
})
