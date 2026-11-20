import { useEffect } from 'react'

import { AppShell } from '@/app/app-shell'
import { useI18n } from '@/app/i18n-provider'
import { mountApp } from '@/app/mount'
import { SimulatorPage } from '@/features/simulator/simulator-page'
import '@/styles/globals.css'

function SimulatorEntry() {
  const { t } = useI18n()
  useEffect(() => {
    document.title = `${t('Webシミュレーター')} | ｽﾀｯｸﾁｬﾝ`
  }, [t])
  return (
    <AppShell current="simulator" surfaceName="Webシミュレーター" rootHref="../">
      <SimulatorPage />
    </AppShell>
  )
}

mountApp(<SimulatorEntry />)
