import { useEffect } from 'react'

import { AppShell } from '@/app/app-shell'
import { useI18n } from '@/app/i18n-provider'
import { mountApp } from '@/app/mount'
import { FaceEditorPage } from '@/features/face-editor/face-editor-page'
import '@/styles/globals.css'

function FaceEditorEntry() {
  const { t } = useI18n()
  useEffect(() => {
    document.title = `${t('Shape顔エディタ')} | ｽﾀｯｸﾁｬﾝ`
  }, [t])
  return (
    <FaceEditorPage
      renderShell={(actions, content) => (
        <AppShell current="face-editor" surfaceName="Shape顔エディタ" rootHref="../" headerActions={actions}>
          {content}
        </AppShell>
      )}
    />
  )
}

mountApp(<FaceEditorEntry />)
