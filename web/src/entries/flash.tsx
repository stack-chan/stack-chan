import { useEffect } from 'react'

import { AppShell } from '@/app/app-shell'
import { useI18n } from '@/app/i18n-provider'
import { mountApp } from '@/app/mount'
import { HostInstallForm } from '@/features/firmware-install/host-install-form'
import '@/styles/globals.css'

function FlashPage() {
  const { t } = useI18n()
  useEffect(() => {
    document.title = `${t('ファームウェア書き込み')} | ｽﾀｯｸﾁｬﾝ`
  }, [t])

  return (
    <AppShell current="flash" surfaceName="ファームウェア書き込み" rootHref="../">
      <div className="page-container grid min-h-[calc(100dvh-4rem)] place-items-center">
        <HostInstallForm />
      </div>
    </AppShell>
  )
}

mountApp(<FlashPage />)
