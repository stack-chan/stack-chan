import { Check, Clipboard } from 'lucide-react'
import { useState } from 'react'

import { useI18n } from '@/app/i18n-provider'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export function CopyableCode({ code, emptyMessage }: { code: string; emptyMessage: string }) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  return (
    <div className="relative">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              className="absolute top-2 right-2 z-10"
              variant="secondary"
              size="icon-sm"
              onClick={() => void copy()}
              disabled={!code}
              aria-label={t('生成コードをコピー')}
            />
          }
        >
          {copied ? <Check /> : <Clipboard />}
        </TooltipTrigger>
        <TooltipContent>{t(copied ? 'コピーしました' : '生成コードをコピー')}</TooltipContent>
      </Tooltip>
      <pre className="max-h-80 overflow-auto rounded-xl bg-console p-3 pr-12 text-xs text-console-foreground">
        <code>{code || emptyMessage}</code>
      </pre>
    </div>
  )
}
