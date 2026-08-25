import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { I18nProvider } from '@/app/i18n-provider'
import { OperationStatus } from '@/components/stackchan/operation-status'
import { AppError } from '@/lib/errors/app-error'

describe('OperationStatus', () => {
  it('renders progress and persistent status text', () => {
    render(
      <I18nProvider>
        <OperationStatus state={{ status: 'pending', message: '書き込み中', progress: 0.42 }} />
      </I18nProvider>
    )
    expect(screen.getByText('処理中')).toBeInTheDocument()
    expect(screen.getByText('書き込み中')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42')
  })

  it('keeps errors in an alert', () => {
    render(
      <I18nProvider>
        <OperationStatus state={{ status: 'error', error: new AppError('write', '接続が切れました') }} />
      </I18nProvider>
    )
    expect(screen.getByRole('alert')).toHaveTextContent('接続が切れました')
  })
})
