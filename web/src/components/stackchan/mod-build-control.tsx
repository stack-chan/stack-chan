import { Download, Hammer, Play, Trash2, Usb } from 'lucide-react'

import { useI18n } from '@/app/i18n-provider'
import { OperationStatus } from '@/components/stackchan/operation-status'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { type OperationState } from '@/features/operations/operation-state'
import { type ProjectAnalysis } from '@/features/project-editor/project-types'
import { type ModBuildResult } from '@/services/mod-builder/mod-build-service'

export function ModBuildControl({
  analysis,
  buildOperation,
  deviceOperation,
  archiveReady,
  onBuild,
  onDownload,
  onRunSimulator,
  onInstallDevice,
  onRemoveDevice,
}: {
  analysis: ProjectAnalysis
  buildOperation: OperationState<ModBuildResult>
  deviceOperation: OperationState
  archiveReady: boolean
  onBuild: () => void
  onDownload: () => void
  onRunSimulator: () => void
  onInstallDevice: () => void
  onRemoveDevice: () => void
}) {
  const { t } = useI18n()
  const busy = buildOperation.status === 'pending' || deviceOperation.status === 'pending'
  return (
    <Card>
      <CardHeader>
        <CardTitle>MOD</CardTitle>
        <CardDescription>
          {analysis.requirements.length
            ? t('使用する能力: {requirements}', {
                requirements: analysis.requirements.join(', '),
              })
            : t('追加のハードウェア能力は使いません')}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Button onClick={onBuild} disabled={!analysis.canBuild || busy}>
          <Hammer data-icon="inline-start" />
          {t('ビルド')}
        </Button>
        <OperationStatus
          state={buildOperation}
          labels={{
            pending: t('ビルド中'),
            success: t('ビルドに成功しました'),
            error: t('ビルドに失敗しました'),
          }}
        />
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={onDownload} disabled={!archiveReady || busy}>
            <Download data-icon="inline-start" />
            {t('ダウンロード')}
          </Button>
          <Button variant="outline" onClick={onRunSimulator} disabled={!archiveReady || busy}>
            <Play data-icon="inline-start" />
            {t('シミュレーターで実行')}
          </Button>
          <Button variant="outline" onClick={onInstallDevice} disabled={!archiveReady || busy}>
            <Usb data-icon="inline-start" />
            {t('実機へ書き込み')}
          </Button>
          <Button variant="destructive" onClick={onRemoveDevice} disabled={busy}>
            <Trash2 data-icon="inline-start" />
            {t('実機のMODを削除')}
          </Button>
        </div>
        <OperationStatus
          state={deviceOperation}
          labels={{
            pending: t('実機を操作しています'),
            success: t('実機の操作に成功しました'),
            cancelled: t('実機の操作をキャンセルしました'),
            error: t('実機の操作に失敗しました'),
          }}
        />
      </CardContent>
    </Card>
  )
}
