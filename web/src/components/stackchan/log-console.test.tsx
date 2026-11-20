import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/app/i18n-provider'
import { LogConsole } from '@/components/stackchan/log-console'
import { TooltipProvider } from '@/components/ui/tooltip'

describe('LogConsole', () => {
  it('renders structured entries and delegates copy and clear actions', async () => {
    const user = userEvent.setup()
    const onClear = vi.fn()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')
    render(
      <I18nProvider>
        <TooltipProvider>
          <LogConsole
            entries={[
              { id: '1', level: 'info', source: 'build', message: 'build started' },
              { id: '2', level: 'error', source: 'device', message: 'device failed' },
            ]}
            onClear={onClear}
          />
        </TooltipProvider>
      </I18nProvider>
    )

    expect(screen.getByRole('log')).toHaveTextContent('build started')
    expect(screen.getByRole('log')).toHaveTextContent('[device]')

    await user.click(screen.getByRole('button', { name: 'ログをコピー' }))
    expect(writeText).toHaveBeenCalledWith('build started\ndevice failed')

    await user.click(screen.getByRole('button', { name: 'ログを消去' }))
    expect(onClear).toHaveBeenCalledOnce()
  })
})
