import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/app/i18n-provider'
import { ModGalleryPage } from '@/features/mod-gallery/mod-gallery-page'
import { loadGalleryCatalog, type ModDefinition } from '@/services/mod-gallery/mod-catalog-service'

vi.mock('@/services/mod-gallery/mod-catalog-service', () => ({
  fetchModArchive: vi.fn(),
  loadGalleryCatalog: vi.fn(),
}))

const textMod: ModDefinition = {
  format: 'tech.stackchan.mod',
  schemaVersion: 1,
  id: 'tech.stackchan.test.source-link',
  version: '1.0.0',
  type: 'text',
  name: 'Source link test',
  description: 'Source link test MOD',
  source: {
    path: 'mod/manifest.json',
    entrypoint: 'mod/mod.js',
  },
  entrypoints: ['mod'],
  targets: ['simulator'],
  capabilities: [],
  artifacts: [],
  definitionUrl: new URL('https://example.test/gallery/stackchan-mod.json'),
  sourceUrl: new URL('https://example.test/gallery/mod/manifest.json'),
  sourceViewUrl: new URL('https://example.test/gallery/mod/mod.js'),
}

describe('ModGalleryPage', () => {
  beforeEach(() => {
    vi.mocked(loadGalleryCatalog).mockResolvedValue([textMod])
  })

  it('uses the viewing entrypoint for the rendered source link', async () => {
    render(
      <I18nProvider>
        <ModGalleryPage />
      </I18nProvider>
    )

    const sourceLink = await screen.findByRole('link', { name: 'ソースを見る' })
    expect(sourceLink).toHaveAttribute('href', textMod.sourceViewUrl.href)
    expect(sourceLink).not.toHaveAttribute('href', textMod.sourceUrl.href)
  })
})
