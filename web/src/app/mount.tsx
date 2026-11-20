import { StrictMode, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'

import { AppProviders } from '@/app/app-providers'
import { applyTheme, readTheme } from '@/lib/theme/theme'

export function mountApp(app: ReactElement) {
  applyTheme(readTheme())
  const root = document.getElementById('root')
  if (!root) throw new Error('Application root #root was not found')
  createRoot(root).render(
    <StrictMode>
      <AppProviders>{app}</AppProviders>
    </StrictMode>
  )
}
