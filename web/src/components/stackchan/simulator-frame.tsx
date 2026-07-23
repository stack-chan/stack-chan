import { forwardRef } from 'react'

import { useI18n } from '@/app/i18n-provider'

export const SimulatorFrame = forwardRef<HTMLIFrameElement, { title?: string; src?: string; className?: string }>(
  function SimulatorFrame({ title = 'Webシミュレーター', src = '../simulator/', className }, ref) {
    const { t } = useI18n()
    return (
      <iframe
        ref={ref}
        className={className ?? 'min-h-[28rem] w-full rounded-xl border bg-simulator-stage'}
        title={t(title)}
        src={src}
        allow="camera; microphone"
      />
    )
  }
)
