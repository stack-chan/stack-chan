import { type RefObject } from 'react'

import { useI18n } from '@/app/i18n-provider'

export function SimulatorSurface({
  viewportRef,
  screenRef,
}: {
  viewportRef: RefObject<HTMLCanvasElement | null>
  screenRef: RefObject<HTMLCanvasElement | null>
}) {
  const { t } = useI18n()
  return (
    <section
      className="relative min-h-[26rem] overflow-hidden rounded-xl border bg-simulator-stage shadow-sm"
      aria-label={t('ｽﾀｯｸﾁｬﾝ3Dシミュレーター')}
    >
      <canvas
        ref={viewportRef}
        className="absolute inset-0 size-full touch-none"
        aria-label={t('3D Stack-chan simulator')}
      />
      <canvas ref={screenRef} className="hidden" width="320" height="240" aria-label="Stack-chan screen canvas" />
    </section>
  )
}
