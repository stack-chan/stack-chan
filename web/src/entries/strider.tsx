import { AppShell } from '@/app/app-shell'
import { mountApp } from '@/app/mount'
import { StriderPage } from '@/features/strider/strider-page'
import '@/styles/globals.css'

mountApp(
  <AppShell current="strider" surfaceName="Strider" rootHref="../">
    <StriderPage />
  </AppShell>
)
