import { CirclePlay } from 'lucide-react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/app/i18n-provider'
import { ModCard } from '@/components/stackchan/mod-card'
import { type ModDefinition } from '@/services/mod-gallery/mod-catalog-service'

const mod: ModDefinition = {
  format: 'tech.stackchan.mod',
  schemaVersion: 1,
  id: 'hello',
  version: '1.0.0',
  type: 'block',
  name: 'Hello MOD',
  description: 'A friendly sample',
  author: 'Stack-chan',
  source: { path: './hello.json' },
  sourceUrl: new URL('https://example.test/hello.json'),
  definitionUrl: new URL('https://example.test/mod.json'),
  targets: ['simulator'],
  capabilities: ['face'],
  artifacts: [],
}

describe('ModCard', () => {
  it('is presentational and delegates its action', () => {
    const onClick = vi.fn()
    render(
      <I18nProvider>
        <ModCard
          mod={mod}
          badges={['simulator', 'face']}
          primaryAction={{ label: '試す', icon: CirclePlay, onClick }}
        />
      </I18nProvider>
    )
    expect(screen.getByText('Hello MOD')).toBeInTheDocument()
    expect(screen.getByText('face')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '試す' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('disables actions while the parent operation is pending', () => {
    render(
      <I18nProvider>
        <ModCard
          mod={mod}
          badges={[]}
          primaryAction={{ label: '試す', icon: CirclePlay }}
          operation={{ status: 'pending', message: '保存中' }}
        />
      </I18nProvider>
    )
    expect(screen.getByRole('button', { name: '試す' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('保存中')
  })
})
