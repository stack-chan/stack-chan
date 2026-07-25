import { CircleCheck, CircleX, Info, LoaderCircle, OctagonAlert } from 'lucide-react'

import { useI18n } from '@/app/i18n-provider'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Progress } from '@/components/ui/progress'
import { type OperationState } from '@/features/operations/operation-state'

export function OperationStatus<T>({
  state,
  labels,
}: {
  state: OperationState<T>
  labels?: Partial<Record<OperationState<T>['status'], string>>
}) {
  const { t } = useI18n()
  if (state.status === 'idle') return null

  const content = {
    pending: {
      icon: <LoaderCircle className="animate-spin" />,
      title: labels?.pending ?? t('処理中'),
      description: state.status === 'pending' && state.message ? t(state.message) : undefined,
    },
    success: {
      icon: <CircleCheck />,
      title: labels?.success ?? t('完了'),
      description: state.status === 'success' && state.message ? t(state.message) : undefined,
    },
    cancelled: {
      icon: <Info />,
      title: labels?.cancelled ?? t('キャンセルしました'),
      description: state.status === 'cancelled' && state.message ? t(state.message) : undefined,
    },
    error: {
      icon: <CircleX />,
      title: labels?.error ?? t('エラーが発生しました'),
      description: state.status === 'error' ? t(state.error.message) : undefined,
    },
  }[state.status]

  return (
    <Alert
      variant={state.status === 'error' ? 'destructive' : 'default'}
      className={state.status === 'success' ? 'border-success/40 bg-success/8' : undefined}
    >
      {state.status === 'error' ? <OctagonAlert /> : content.icon}
      <AlertTitle>{content.title}</AlertTitle>
      {content.description && <AlertDescription>{content.description}</AlertDescription>}
      {state.status === 'pending' && state.progress !== undefined && (
        <Progress className="col-span-full mt-2" value={Math.round(state.progress * 100)} />
      )}
    </Alert>
  )
}
