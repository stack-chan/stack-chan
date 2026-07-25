import { useMemo } from 'react'

import { useI18n } from '@/app/i18n-provider'
import { SimulatorSurface } from '@/components/stackchan/simulator-surface'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useSimulatorEngine } from '@/features/simulator/use-simulator-engine'
import { type SimulatorReady } from '@/services/simulator/simulator-engine.mjs'

type ProjectSimulatorDialogProps = {
  open: boolean
  archive: Uint8Array | null
  archiveName: string
  onOpenChange: (open: boolean) => void
  onTrace?: (message: string) => void
  onReady?: (ready: SimulatorReady) => void
  onError?: (error: unknown) => void
}

function ProjectSimulatorRuntime({
  archive,
  archiveName,
  onTrace,
  onReady,
  onError,
}: Omit<ProjectSimulatorDialogProps, 'open' | 'onOpenChange'> & { archive: Uint8Array }) {
  const initialMod = useMemo(() => ({ name: archiveName, bytes: archive }), [archive, archiveName])
  const simulator = useSimulatorEngine({
    initialMod,
    persistence: 'session',
    runtimeBaseUrl: new URL('../simulator/', document.baseURI).href,
    onTrace,
    onReady,
    onError,
  })

  return (
    <div className="min-h-0" data-testid="project-simulator">
      <SimulatorSurface controller={simulator} embedded />
    </div>
  )
}

export function ProjectSimulatorDialog({
  open,
  archive,
  archiveName,
  onOpenChange,
  onTrace,
  onReady,
  onError,
}: ProjectSimulatorDialogProps) {
  const { t } = useI18n()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="h-[calc(100dvh-1rem)] w-[calc(100dvw-1rem)] max-w-none! grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-none!"
        closeLabel={t('閉じる')}
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>{t('シミュレーター')}</DialogTitle>
          <DialogDescription>{t('ビルドしたMODをブラウザー内で実行します。')}</DialogDescription>
        </DialogHeader>
        {archive ? (
          <ProjectSimulatorRuntime
            archive={archive}
            archiveName={archiveName}
            onTrace={onTrace}
            onReady={onReady}
            onError={onError}
          />
        ) : (
          <p className="text-sm text-muted-foreground" role="status">
            {t('MODなし')}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('閉じる')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
