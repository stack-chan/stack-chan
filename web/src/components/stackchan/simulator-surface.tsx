import { Camera, Download, FileUp, RotateCw, Trash2 } from 'lucide-react'
import { useRef, type RefObject } from 'react'

import { useI18n } from '@/app/i18n-provider'
import { LogConsole, type LogEntry } from '@/components/stackchan/log-console'
import { OperationStatus } from '@/components/stackchan/operation-status'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { type OperationState } from '@/features/operations/operation-state'
import {
  type CameraStatus,
  type InstalledMod,
  type SimulatorModResult,
} from '@/services/simulator/simulator-engine.mjs'
import { cn } from '@/lib/utils'

const sampleModUrl = new URL('../../../simulator/samples/stackchan-sample-mod.xsa', import.meta.url).href

export type SimulatorSurfaceController = {
  viewportRef: RefObject<HTMLCanvasElement | null>
  screenRef: RefObject<HTMLCanvasElement | null>
  operation: OperationState
  modState: {
    result: SimulatorModResult
    installedMod?: InstalledMod | null
  }
  cameraStatus: CameraStatus
  logs: LogEntry[]
  clearLogs: () => void
  installMod: (file: File) => Promise<void>
  restart: () => Promise<void>
  clearMod: () => Promise<void>
  connectCamera: () => Promise<void>
  pushButton: (name: 'a' | 'b' | 'c') => void
}

function formatByteSize(bytes?: number) {
  if (bytes === undefined) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function describeMod(result: SimulatorModResult, installedMod?: InstalledMod | null) {
  const name = result.name ?? installedMod?.name
  const size = result.size ?? installedMod?.size
  const identity = name ? `${name} · ${formatByteSize(size)}` : ''
  switch (result.status) {
    case 'empty':
      return 'MODなし'
    case 'restarting':
      return `${identity ? `${identity} · ` : ''}再起動中`
    case 'prepared':
      return `${identity} · 起動準備済み`
    case 'installed':
      return `${identity} · 適用済み`
    case 'unsupported':
    case 'saved':
      return `${identity} · ${installedMod?.storage === 'memory' ? 'セッション保存' : '保存済み'}`
    case 'error':
      return `MODエラー · ${result.error ?? '不明なエラー'}`
  }
  const unhandledStatus: never = result.status
  return unhandledStatus
}

export function SimulatorViewport({
  viewportRef,
  screenRef,
  className,
}: Pick<SimulatorSurfaceController, 'viewportRef' | 'screenRef'> & { className?: string }) {
  const { t } = useI18n()
  return (
    <section
      className={cn('relative min-h-[26rem] overflow-hidden rounded-xl border bg-simulator-stage shadow-sm', className)}
      aria-label={t('ｽﾀｯｸﾁｬﾝ3Dシミュレーター')}
    >
      <canvas
        ref={viewportRef}
        className="absolute inset-0 size-full touch-none"
        aria-label={t('ｽﾀｯｸﾁｬﾝ3Dシミュレーター')}
      />
      <canvas ref={screenRef} className="hidden" width="320" height="240" aria-hidden="true" />
    </section>
  )
}

function ModRuntimeControl({ controller }: { controller: SimulatorSurfaceController }) {
  const { t } = useI18n()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const modBusy = controller.modState.result.status === 'restarting'

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>MOD</CardTitle>
            <CardDescription className="mt-1">
              {t('XSアーカイブを保存してシミュレーターで実行します。')}
            </CardDescription>
          </div>
          <Badge variant={controller.modState.result.status === 'error' ? 'destructive' : 'secondary'}>
            {controller.modState.result.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        <input
          ref={fileInputRef}
          className="sr-only"
          type="file"
          aria-label={t('MODを追加')}
          accept=".xsa,application/octet-stream"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            if (file) void controller.installMod(file)
            event.currentTarget.value = ''
          }}
        />
        <Button onClick={() => fileInputRef.current?.click()} disabled={modBusy}>
          <FileUp data-icon="inline-start" />
          {t('MODを追加')}
        </Button>
        <p className="min-h-5 text-sm text-muted-foreground" role="status">
          {t(describeMod(controller.modState.result, controller.modState.installedMod))}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => void controller.restart()} disabled={modBusy}>
            <RotateCw data-icon="inline-start" />
            {t('再起動')}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="destructive" disabled={modBusy} />}>
              <Trash2 data-icon="inline-start" />
              {t('削除')}
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogMedia>
                  <Trash2 />
                </AlertDialogMedia>
                <AlertDialogTitle>{t('保存したMODを削除しますか？')}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t('シミュレーターの保存領域からXSアーカイブを削除します。')}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('キャンセル')}</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => void controller.clearMod()}>
                  {t('削除')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
        <Button variant="link" render={<a href={sampleModUrl} download="stackchan-sample-mod.xsa" />}>
          <Download data-icon="inline-start" />
          {t('サンプルMODをダウンロード')}
        </Button>
      </CardContent>
    </Card>
  )
}

function SimulatorToolbar({ controller }: { controller: SimulatorSurfaceController }) {
  const { t } = useI18n()
  const cameraBusy = controller.cameraStatus.status === 'pending'
  const cameraLabel = {
    idle: '未接続',
    pending: '接続中',
    connected: '接続済み',
    fallback: '利用できません · 合成映像',
    error: `接続失敗 · 合成映像`,
  }[controller.cameraStatus.status]

  return (
    <aside className="grid content-start gap-4" aria-label={t('シミュレーター操作')}>
      <ModRuntimeControl controller={controller} />

      <Card>
        <CardHeader>
          <CardTitle>{t('本体ボタン')}</CardTitle>
          <CardDescription>{t('ｽﾀｯｸﾁｬﾝのA・B・Cボタンを操作します。')}</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-2">
          {(['a', 'b', 'c'] as const).map((name) => (
            <Button key={name} variant="outline" onClick={() => controller.pushButton(name)}>
              {name.toUpperCase()}
            </Button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('カメラ')}</CardTitle>
          <CardDescription role="status">{t(cameraLabel)}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            className="w-full"
            variant="outline"
            onClick={() => void controller.connectCamera()}
            disabled={cameraBusy}
          >
            <Camera data-icon="inline-start" />
            {t('カメラを接続')}
          </Button>
        </CardContent>
      </Card>
    </aside>
  )
}

export function SimulatorSurface({
  controller,
  embedded = false,
}: {
  controller: SimulatorSurfaceController
  embedded?: boolean
}) {
  const { t } = useI18n()
  return (
    <div
      className={cn(
        'grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]',
        embedded ? 'h-full min-h-0 overflow-auto pr-1' : 'page-container'
      )}
    >
      <div className="grid min-w-0 gap-4">
        <SimulatorViewport
          viewportRef={controller.viewportRef}
          screenRef={controller.screenRef}
          className={embedded ? 'min-h-[28rem]' : undefined}
        />
        <OperationStatus
          state={controller.operation}
          labels={{
            pending: t('シミュレーターを準備しています'),
            success: t('シミュレーターを実行中'),
            error: t('シミュレーターを起動できませんでした'),
          }}
        />
        <LogConsole
          entries={controller.logs}
          onClear={controller.clearLogs}
          title={t('ファームウェアログ')}
          viewportClassName={embedded ? 'h-36' : undefined}
        />
      </div>

      <SimulatorToolbar controller={controller} />
    </div>
  )
}
