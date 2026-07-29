import { useEffect } from 'react'

import { AppShell } from '@/app/app-shell'
import { useI18n } from '@/app/i18n-provider'
import { mountApp } from '@/app/mount'
import { ProjectEditorPage } from '@/features/project-editor/project-editor-page'
import '@/styles/globals.css'

function EditorEntry() {
  const { t } = useI18n()
  useEffect(() => {
    document.title = `${t('ブロックエディタ')} | ｽﾀｯｸﾁｬﾝ`
  }, [t])
  return (
    <AppShell current="editor" surfaceName="ブロックエディタ" rootHref="../">
      <ProjectEditorPage />
    </AppShell>
  )
}

mountApp(<EditorEntry />)
