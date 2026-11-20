import { useEffect } from 'react'

import { AppShell } from '@/app/app-shell'
import { useI18n } from '@/app/i18n-provider'
import { mountApp } from '@/app/mount'
import { MediaPipePage } from '@/features/mediapipe/mediapipe-page'
import '@/styles/globals.css'

function MediaPipeEntry() {
  const { t } = useI18n()

  useEffect(() => {
    document.title = `${t('MediaPipe BLE追従')} | ｽﾀｯｸﾁｬﾝ`
  }, [t])

  return (
    <AppShell current="mediapipe" surfaceName="MediaPipe BLE追従" rootHref="../">
      <MediaPipePage />
    </AppShell>
  )
}

mountApp(<MediaPipeEntry />)
