import { type ReactNode } from 'react'

import { I18nProvider } from '@/app/i18n-provider'
import { ThemeProvider } from '@/app/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { WebMcpProvider } from '@/services/webmcp/react'

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <I18nProvider>
        <TooltipProvider>
          <WebMcpProvider>
            {children}
            <Toaster position="bottom-right" />
          </WebMcpProvider>
        </TooltipProvider>
      </I18nProvider>
    </ThemeProvider>
  )
}
