import { useEffect } from 'react'

import { AppShell } from '@/app/app-shell'
import { useI18n } from '@/app/i18n-provider'
import { mountApp } from '@/app/mount'
import { TutorialPage } from '@/features/tutorial/tutorial-page'
import '@/styles/globals.css'

function TutorialEntry() {
  const { t } = useI18n()
  useEffect(() => {
    document.title = `${t('ブロックエディタ チュートリアル')} | ｽﾀｯｸﾁｬﾝ`
  }, [t])
  return (
    <AppShell current="tutorial" surfaceName="ブロックエディタ チュートリアル" rootHref="../">
      <TutorialPage />
    </AppShell>
  )
}

mountApp(<TutorialEntry />)
