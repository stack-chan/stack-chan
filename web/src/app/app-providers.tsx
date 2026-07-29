import { type ReactNode } from 'react'

import { I18nProvider } from '@/app/i18n-provider'
import { ThemeProvider } from '@/app/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <I18nProvider>
        <TooltipProvider>
          {children}
          <Toaster position="bottom-right" />
        </TooltipProvider>
      </I18nProvider>
    </ThemeProvider>
  )
}
