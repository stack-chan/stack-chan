import { useEffect } from 'react'

import { AppShell } from '@/app/app-shell'
import { useI18n } from '@/app/i18n-provider'
import { mountApp } from '@/app/mount'
import { PreferencesPage } from '@/features/preferences/preferences-page'
import '@/styles/globals.css'

function PreferenceEntry() {
  const { t } = useI18n()
  useEffect(() => {
    document.title = `${t('設定')} | ｽﾀｯｸﾁｬﾝ`
  }, [t])
  return (
    <AppShell current="preference" surfaceName="設定" rootHref="../">
      <PreferencesPage />
    </AppShell>
  )
}

mountApp(<PreferenceEntry />)
