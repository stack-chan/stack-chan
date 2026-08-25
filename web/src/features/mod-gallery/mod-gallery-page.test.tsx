import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/app/i18n-provider'
import { ModGalleryPage } from '@/features/mod-gallery/mod-gallery-page'
import { loadGalleryCatalog, type ModDefinition } from '@/services/mod-gallery/mod-catalog-service'

vi.mock('@/services/mod-gallery/mod-catalog-service', () => ({
  fetchModArchive: vi.fn(),
  loadGalleryCatalog: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

const textMod: ModDefinition = {
  format: 'tech.stackchan.mod',
  schemaVersion: 1,
  id: 'tech.stackchan.test.source-link',
  version: '1.0.0',
  type: 'text',
  name: 'Source link test',
  description: 'Source link test MOD',
  setup: {
    url: 'https://example.test/setup/',
  },
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
  setupUrl: new URL('https://example.test/setup/'),
}

describe('ModGalleryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('opens the setup guide in a separate tab', async () => {
    render(
      <I18nProvider>
        <ModGalleryPage />
      </I18nProvider>
    )

    const setupLink = await screen.findByRole('link', { name: 'セットアップ手順' })
    expect(setupLink).toHaveAttribute('href', textMod.setupUrl?.href)
    expect(setupLink).toHaveAttribute('target', '_blank')
    expect(setupLink).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('filters cards with the radio group', async () => {
    const blockMod: ModDefinition = {
      ...textMod,
      id: 'tech.stackchan.test.block',
      type: 'block',
      name: 'Block test',
      source: { path: 'sample.stackchan-blocks.json' },
      sourceUrl: new URL('https://example.test/gallery/sample.stackchan-blocks.json'),
      sourceViewUrl: new URL('https://example.test/gallery/sample.stackchan-blocks.json'),
    }
    vi.mocked(loadGalleryCatalog).mockResolvedValue([textMod, blockMod])
    const user = userEvent.setup()

    render(
      <I18nProvider>
        <ModGalleryPage />
      </I18nProvider>
    )

    await screen.findByText('Source link test')
    await user.click(screen.getByRole('radio', { name: 'ブロック' }))
    expect(screen.queryByText('Source link test')).not.toBeInTheDocument()
    expect(screen.getByText('Block test')).toBeInTheDocument()
  })

  it('explains the mini-app entrypoint in a popover', async () => {
    vi.mocked(loadGalleryCatalog).mockResolvedValue([{ ...textMod, entrypoints: ['miniapp'] }])
    const user = userEvent.setup()

    render(
      <I18nProvider>
        <ModGalleryPage />
      </I18nProvider>
    )

    await user.click(await screen.findByRole('button', { name: 'ミニアプリについて' }))
    expect(
      screen.getByText('ミニアプリは本体のAppBarから起動し、hostが管理する画面内で動作します。')
    ).toBeInTheDocument()
    expect(screen.getByText('entrypoint: miniapp')).toBeInTheDocument()
  })

  it('reports device write errors through the mounted toaster', async () => {
    vi.mocked(loadGalleryCatalog).mockResolvedValue([
      {
        ...textMod,
        targets: ['m5stackchan-cores3'],
        artifacts: [
          {
            format: 'xsa',
            path: 'sample.xsa',
            target: 'm5stackchan-cores3',
            url: new URL('https://example.test/gallery/sample.xsa'),
          },
        ],
      },
    ])
    const user = userEvent.setup()

    render(
      <I18nProvider>
        <ModGalleryPage />
      </I18nProvider>
    )

    await user.click(await screen.findByRole('button', { name: '実機へ書き込む' }))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('実機への書き込みにはChromeまたはEdgeを使ってください')
    )
  })
})
