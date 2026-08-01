import { Check, Clipboard, TriangleAlert } from 'lucide-react'
import { useState } from 'react'

import { useI18n } from '@/app/i18n-provider'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export function CopyableCode({ code, emptyMessage }: { code: string; emptyMessage: string }) {
  const { t } = useI18n()
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle')

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setStatus('copied')
    } catch {
      setStatus('error')
    }
    window.setTimeout(() => setStatus('idle'), 1200)
  }

  const statusLabel =
    status === 'copied'
      ? 'コピーしました'
      : status === 'error'
        ? '生成コードをコピーできませんでした'
        : '生成コードをコピー'

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
              aria-label={t(statusLabel)}
            />
          }
        >
          {status === 'copied' ? <Check /> : status === 'error' ? <TriangleAlert /> : <Clipboard />}
        </TooltipTrigger>
        <TooltipContent>{t(statusLabel)}</TooltipContent>
      </Tooltip>
      <span className="sr-only" role="status" aria-live="polite">
        {status === 'idle' ? '' : t(statusLabel)}
      </span>
      <pre className="max-h-80 overflow-auto rounded-xl bg-console p-3 pr-12 text-xs text-console-foreground">
        <code>{code || emptyMessage}</code>
      </pre>
    </div>
  )
}
