import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/app/i18n-provider'
import { PreferencesPage } from '@/features/preferences/preferences-page'
import { DEFAULT_PREFERENCES } from '@/features/preferences/preference-model'
import { usePreferences } from '@/features/preferences/use-preferences'

vi.mock('@/features/preferences/use-preferences', () => ({
  usePreferences: vi.fn(),
}))

describe('PreferencesPage', () => {
  it('shows the MCP server token as a password field', () => {
    vi.mocked(usePreferences).mockReturnValue({
      connection: 'connected',
      connected: true,
      busy: false,
      values: DEFAULT_PREFERENCES,
      readOnly: new Set(),
      operation: { status: 'idle' },
      connect: vi.fn(async () => {}),
      disconnect: vi.fn(async () => {}),
      update: vi.fn(),
      save: vi.fn(async () => {}),
      clearWifi: vi.fn(async () => {}),
    })

    render(
      <I18nProvider>
        <PreferencesPage />
      </I18nProvider>
    )

    const token = screen.getByLabelText('Bearerトークン')
    expect(token).toHaveAttribute('name', 'mcp.token')
    expect(token).toHaveAttribute('type', 'password')
  })
})
