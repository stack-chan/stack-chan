import { Check, Clipboard, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { useI18n } from '@/app/i18n-provider'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export type LogLevel = 'trace' | 'info' | 'warning' | 'error'
export type LogSource = 'build' | 'simulator' | 'device' | 'system'

export type LogEntry = {
  id: string
  timestamp?: number
  level: LogLevel
  source?: LogSource
  message: string
}

const levelClass: Record<LogLevel, string> = {
  trace: 'text-console-foreground/65',
  info: 'text-console-foreground',
  warning: 'text-warning',
  error: 'text-red-300',
}

export function LogConsole({
  entries,
  onClear,
  title = 'ログ',
  emptyMessage = 'ログはまだありません。',
  className,
  viewportClassName,
}: {
  entries: readonly LogEntry[]
  onClear?: () => void
  title?: string
  emptyMessage?: string
  className?: string
  viewportClassName?: string
}) {
  const { t } = useI18n()
  const viewportRef = useRef<HTMLDivElement>(null)
  const [level, setLevel] = useState<LogLevel | 'all'>('all')
  const [source, setSource] = useState<LogSource | 'all'>('all')
  const [pinnedToEnd, setPinnedToEnd] = useState(true)
  const [copied, setCopied] = useState(false)
  const sources = useMemo(
    () => Array.from(new Set(entries.flatMap((entry) => (entry.source ? [entry.source] : [])))),
    [entries]
  )
  const visible = useMemo(
    () =>
      entries.filter(
        (entry) => (level === 'all' || entry.level === level) && (source === 'all' || entry.source === source)
      ),
    [entries, level, source]
  )

  useEffect(() => {
    if (pinnedToEnd && viewportRef.current) viewportRef.current.scrollTop = viewportRef.current.scrollHeight
  }, [pinnedToEnd, visible])

  const copy = async () => {
    await navigator.clipboard.writeText(visible.map((entry) => entry.message).join('\n'))
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  return (
    <section className={cn('overflow-hidden rounded-xl border bg-card', className)} aria-label={t(title)}>
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b px-3 py-2">
        <h2 className="min-w-0 truncate text-sm font-semibold">{t(title)}</h2>
        <div className="flex shrink-0 items-center gap-2">
          <Select value={level} onValueChange={(value) => value && setLevel(value as LogLevel | 'all')}>
            <SelectTrigger className="w-28" size="sm" aria-label={t('ログレベル')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('すべて')}</SelectItem>
              <SelectItem value="trace">trace</SelectItem>
              <SelectItem value="info">info</SelectItem>
              <SelectItem value="warning">warning</SelectItem>
              <SelectItem value="error">error</SelectItem>
            </SelectContent>
          </Select>
          {sources.length > 1 && (
            <Select value={source} onValueChange={(value) => value && setSource(value as LogSource | 'all')}>
              <SelectTrigger className="w-28" size="sm" aria-label={t('ログの生成元')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('すべて')}</SelectItem>
                {sources.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => void copy()}
                  disabled={visible.length === 0}
                  aria-label={t('ログをコピー')}
                />
              }
            >
              {copied ? <Check /> : <Clipboard />}
            </TooltipTrigger>
            <TooltipContent>{t(copied ? 'コピーしました' : 'ログをコピー')}</TooltipContent>
          </Tooltip>
          {onClear && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={onClear}
                    disabled={entries.length === 0}
                    aria-label={t('ログを消去')}
                  />
                }
              >
                <Trash2 />
              </TooltipTrigger>
              <TooltipContent>{t('ログを消去')}</TooltipContent>
            </Tooltip>
          )}
        </div>
      </header>
      <div
        ref={viewportRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        className={cn(
          'h-56 overflow-auto bg-console px-3 py-2 font-mono text-xs leading-5 text-console-foreground',
          viewportClassName
        )}
        onScroll={(event) => {
          const element = event.currentTarget
          setPinnedToEnd(element.scrollHeight - element.scrollTop - element.clientHeight < 12)
        }}
      >
        {visible.length === 0 ? (
          <p className="text-console-foreground/55">{t(emptyMessage)}</p>
        ) : (
          visible.map((entry) => (
            <div key={entry.id} className={cn('grid grid-cols-[auto_auto_1fr] gap-2', levelClass[entry.level])}>
              {entry.timestamp ? (
                <time dateTime={new Date(entry.timestamp).toISOString()}>
                  {new Date(entry.timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </time>
              ) : (
                <span />
              )}
              <span>{entry.source ? `[${entry.source}]` : ''}</span>
              <span className="whitespace-pre-wrap break-words">{entry.message}</span>
            </div>
          ))
        )}
      </div>
    </section>
  )
}
