import { useEffect } from 'react'

import { AppShell } from '@/app/app-shell'
import { useI18n } from '@/app/i18n-provider'
import { mountApp } from '@/app/mount'
import { ModGalleryPage } from '@/features/mod-gallery/mod-gallery-page'
import '@/styles/globals.css'

function GalleryEntry() {
  const { t } = useI18n()
  useEffect(() => {
    document.title = `MOD Gallery | ｽﾀｯｸﾁｬﾝ`
  }, [t])
  return (
    <AppShell current="mod-gallery" surfaceName="MOD Gallery" rootHref="../">
      <ModGalleryPage />
    </AppShell>
  )
}

mountApp(<GalleryEntry />)
