import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { I18nProvider, useI18n } from '@/app/i18n-provider'

function I18nProbe() {
  const { setLocale, t } = useI18n()
  return (
    <>
      <button type="button" onClick={() => setLocale('en')}>
        English
      </button>
      <span data-testid="explicit">{t('設定')}</span>
      <span data-testid="raw">設定</span>
    </>
  )
}

describe('I18nProvider', () => {
  it('translates explicit lookups without rewriting arbitrary rendered text', async () => {
    const user = userEvent.setup()
    render(
      <I18nProvider>
        <I18nProbe />
      </I18nProvider>
    )

    await user.click(screen.getByRole('button', { name: 'English' }))

    expect(screen.getByTestId('explicit')).toHaveTextContent('Settings')
    expect(screen.getByTestId('raw')).toHaveTextContent('設定')
    expect(document.documentElement).toHaveAttribute('lang', 'en')
  })
})
