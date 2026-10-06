import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import userEvent from '@testing-library/user-event'
import type { RegisteredTool } from '@/services/webmcp/runtime'
import { WebMcpProvider } from '@/services/webmcp/react'
import { I18nProvider } from '@/app/i18n-provider'
import { PreferencesPage } from '@/features/preferences/preferences-page'
import { DEFAULT_PREFERENCES } from '@/features/preferences/preference-model'
import { usePreferences } from '@/features/preferences/use-preferences'

vi.mock('@/features/preferences/use-preferences', () => ({
  usePreferences: vi.fn(),
}))

describe('PreferencesPage', () => {
  beforeEach(() => {
    vi.mocked(usePreferences).mockReturnValue({
      getState: () => ({
        session: 0,
        connected: true,
        values: DEFAULT_PREFERENCES,
        received: {},
        dirty: [],
        readOnly: [],
        sending: false,
      }),
      connection: 'connected',
      connected: true,
      busy: false,
      values: DEFAULT_PREFERENCES,
      readOnly: new Set(),
      operation: { status: 'idle' },
      connect: vi.fn(async () => ({ ok: true as const, status: 'sent', sentKeys: [] })),
      disconnect: vi.fn(async () => ({ ok: true as const, status: 'sent', sentKeys: [] })),
      update: vi.fn(),
      save: vi.fn(async () => ({ ok: true as const, status: 'sent', sentKeys: [] })),
      clearWifi: vi.fn(async () => ({ ok: true as const, status: 'sent', sentKeys: [] })),
    })
  })
  afterEach(() => {
    Reflect.deleteProperty(document, 'modelContext')
  })

  it('shows the MCP server token as a password field', () => {
    render(
      <I18nProvider>
        <WebMcpProvider>
          <PreferencesPage />
        </WebMcpProvider>
      </I18nProvider>
    )

    const token = screen.getByLabelText('Bearerトークン')
    expect(token).toHaveAttribute('name', 'mcp.token')
    expect(token).toHaveAttribute('type', 'password')
  })
  it('uses the visible confirmation for an AI-requested Wi-Fi clear', async () => {
    const registry = new Map<string, RegisteredTool>()
    Object.defineProperty(document, 'modelContext', {
      configurable: true,
      value: {
        registerTool(tool: RegisteredTool, { signal }: { signal: AbortSignal }) {
          registry.set(tool.name, tool)
          signal.addEventListener('abort', () => registry.delete(tool.name))
        },
      },
    })
    render(
      <I18nProvider>
        <WebMcpProvider>
          <PreferencesPage />
        </WebMcpProvider>
      </I18nProvider>
    )
    await waitFor(() => expect(registry.size).toBe(7))
    const current = (await registry.get('stackchan.preferences.get')!.execute({})) as { data: { revision: string } }
    await act(async () => {
      await registry
        .get('stackchan.preferences.request_clear_wifi')!
        .execute({ expectedRevision: current.data.revision })
    })
    const preferences = vi.mocked(usePreferences).mock.results.at(-1)!.value
    expect(preferences.clearWifi).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: '消去する' }))
    await waitFor(() => expect(preferences.clearWifi).toHaveBeenCalledOnce())
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})
