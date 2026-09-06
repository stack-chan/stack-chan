import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'

import { useI18n } from '@/app/i18n-provider'
import { Button } from '@/components/ui/button'
import { getModelContext, Operations, registerTools, type ToolDefinition } from './runtime'

const Context = createContext<Operations | null>(null)

export function WebMcpProvider({ children }: { children: ReactNode }) {
  const [operations] = useState(() => new Operations())
  useEffect(() => () => operations.dispose(), [operations])
  return <Context.Provider value={operations}>{children}</Context.Provider>
}

export function useOperations() {
  const operations = useContext(Context)
  if (!operations) throw new Error('WebMcpProvider is required')
  return operations
}

export function useWebMcpTools(definitions: ToolDefinition[]) {
  const operations = useOperations()
  const latest = useRef(definitions)
  latest.current = definitions
  const signature = definitions.map((definition) => definition.name).join('|')
  const [status, setStatus] = useState<'unsupported' | 'registering' | 'ready' | 'error'>('unsupported')
  useEffect(() => {
    const controller = new AbortController()
    const context = getModelContext()
    if (!context) {
      setStatus('unsupported')
      return
    }
    setStatus('registering')
    operations.registration(signature, 'registering')
    void registerTools(context, latest.current, controller.signal, (name) =>
      latest.current.find((tool) => tool.name === name)
    )
      .then(() => {
        if (!controller.signal.aborted) {
          setStatus('ready')
          operations.registration(signature, 'ready')
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setStatus('error')
          operations.registration(signature, 'error')
        }
      })
    return () => {
      controller.abort()
      operations.registration(signature)
    }
  }, [signature, operations])
  return status
}

export function WebMcpOperationStatus() {
  const operations = useOperations()
  useSyncExternalStore(operations.subscribe, operations.snapshot)
  const { t } = useI18n()
  const current = operations.list().at(-1)
  if ([...operations.registrations.values()].includes('error'))
    return (
      <p role="alert" className="border-b px-4 py-3 text-sm text-destructive">
        {t('AI連携を登録できませんでした。ページを再読み込みしてください。')}
      </p>
    )
  if (!current) return null
  const labels = {
    waiting_user: '操作を確認してください',
    running: '処理中',
    succeeded: '操作を終了しました',
    failed: '操作に失敗しました',
    cancelled: '操作をキャンセルしました。',
  }
  return (
    <section
      className="flex flex-wrap items-center gap-3 border-b bg-muted/50 px-4 py-3"
      aria-label={t('AIからの操作')}
    >
      <p role="status" className="min-w-0 flex-1 text-sm break-words">
        {t(current.label)} — {t(labels[current.status])}
        {current.error && <span className="block text-destructive">{t(current.error.message)}</span>}
      </p>
      {current.actionLabel && current.status === 'waiting_user' && (
        <Button onClick={() => void operations.run(current.id)}>{t(current.actionLabel)}</Button>
      )}
      {current.cancellable && (
        <Button variant="outline" onClick={() => operations.cancel(current.id)}>
          {t('キャンセル')}
        </Button>
      )}
    </section>
  )
}

export function useBeforeNavigate(guard: () => void | Promise<void>) {
  const operations = useOperations()
  const latest = useRef(guard)
  latest.current = guard
  useEffect(() => {
    const callback = () => latest.current()
    operations.navigationGuards.add(callback)
    return () => {
      operations.navigationGuards.delete(callback)
    }
  }, [operations])
}
