import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/app/i18n-provider'
import { CopyableCode } from '@/components/stackchan/copyable-code'
import { TooltipProvider } from '@/components/ui/tooltip'

describe('CopyableCode', () => {
  it('copies all generated code without requiring text selection', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')
    render(
      <I18nProvider>
        <TooltipProvider>
          <CopyableCode code={'export function onLaunch() {\n  return true\n}'} emptyMessage="empty" />
        </TooltipProvider>
      </I18nProvider>
    )

    await user.click(screen.getByRole('button', { name: '生成コードをコピー' }))

    expect(writeText).toHaveBeenCalledWith('export function onLaunch() {\n  return true\n}')
    expect(await screen.findByRole('button', { name: 'コピーしました' })).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('コピーしました')
  })

  it('shows a localized error when clipboard access fails', async () => {
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(new Error('clipboard unavailable'))
    render(
      <I18nProvider>
        <TooltipProvider>
          <CopyableCode code="trace('hello')" emptyMessage="empty" />
        </TooltipProvider>
      </I18nProvider>
    )

    await user.click(screen.getByRole('button', { name: '生成コードをコピー' }))

    expect(await screen.findByRole('button', { name: '生成コードをコピーできませんでした' })).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('生成コードをコピーできませんでした')
  })

  it('disables copy when generated code is empty', () => {
    render(
      <I18nProvider>
        <TooltipProvider>
          <CopyableCode code="" emptyMessage="コードはまだ生成されていません" />
        </TooltipProvider>
      </I18nProvider>
    )

    expect(screen.getByRole('button', { name: '生成コードをコピー' })).toBeDisabled()
  })
})
