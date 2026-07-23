import { Cpu, RotateCcw, Usb } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'

import { useI18n } from '@/app/i18n-provider'
import { LogConsole } from '@/components/stackchan/log-console'
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
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FIRMWARE_BOARDS } from '@/features/firmware-install/boards'
import { useFirmwareInstall } from '@/features/firmware-install/use-firmware-install'
import { type OperationState } from '@/features/operations/operation-state'
import { useLogBuffer } from '@/hooks/use-log-buffer'

export function HostInstallForm() {
  const { t } = useI18n()
  const [boardId, setBoardId] = useState(FIRMWARE_BOARDS[0].id)
  const { entries, append, clear } = useLogBuffer()
  const onLog = useCallback(
    (message: string, level: 'info' | 'warning' | 'error' = 'info') => append(message, level, 'device'),
    [append]
  )
  const install = useFirmwareInstall(onLog)
  const board = FIRMWARE_BOARDS.find((candidate) => candidate.id === boardId) ?? FIRMWARE_BOARDS[0]
  const busy = ['selecting-port', 'inspecting-device', 'confirming', 'installing'].includes(install.state.status)

  const operation = useMemo<OperationState>(() => {
    switch (install.state.status) {
      case 'idle':
        return { status: 'idle' }
      case 'selecting-port':
        return { status: 'pending', message: t('USBデバイスを選択しています') }
      case 'inspecting-device':
        return { status: 'pending', message: t('接続したデバイスを確認しています') }
      case 'confirming':
        return { status: 'pending', message: t('書き込み内容を確認してください') }
      case 'installing':
        return { status: 'pending', message: t('ファームウェアを書き込んでいます'), progress: install.state.progress }
      case 'success':
        return {
          status: 'success',
          result: install.state.result,
          message: t('書き込みが終了し、デバイスを再起動しました。'),
        }
      case 'cancelled':
        return { status: 'cancelled', message: t('デバイスには変更を加えていません。') }
      case 'error':
        return { status: 'error', error: install.state.error }
    }
  }, [install.state, t])

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-5">
      <Card>
        <CardHeader>
          <CardTitle>{t('ファームウェア書き込み')}</CardTitle>
          <CardDescription>{t('USBで接続するｽﾀｯｸﾁｬﾝのボードを選択してください。')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid gap-2">
            <Label htmlFor="target-board">{t('ボード')}</Label>
            <Select value={boardId} onValueChange={(value) => value && setBoardId(value)} disabled={busy}>
              <SelectTrigger id="target-board" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FIRMWARE_BOARDS.map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    {candidate.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <OperationStatus
            state={operation}
            labels={{
              pending: t('書き込み処理中'),
              success: t('書き込みに成功しました'),
              cancelled: t('書き込みをキャンセルしました'),
              error: t('書き込みに失敗しました'),
            }}
          />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button className="min-h-10 flex-1" onClick={() => void install.install(board)} disabled={busy}>
              <Usb data-icon="inline-start" />
              {install.state.status === 'idle' ? t('USBに接続して書き込む') : t('もう一度書き込む')}
            </Button>
            {!busy && install.state.status !== 'idle' && (
              <Button variant="outline" onClick={install.reset}>
                <RotateCcw data-icon="inline-start" />
                {t('状態をリセット')}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <LogConsole entries={entries} onClear={clear} title={t('書き込みログ')} />

      <AlertDialog
        open={install.state.status === 'confirming'}
        onOpenChange={(open) => {
          if (!open && install.state.status === 'confirming') install.cancel()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <Cpu />
            </AlertDialogMedia>
            <AlertDialogTitle>{t('このデバイスへ書き込みますか？')}</AlertDialogTitle>
            <AlertDialogDescription>{t('既存のファームウェアを選択した内容で上書きします。')}</AlertDialogDescription>
          </AlertDialogHeader>
          {install.state.status === 'confirming' && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg bg-muted p-3 text-sm">
              <dt className="text-muted-foreground">{t('ボード')}</dt>
              <dd className="font-medium">{install.state.device.board.label}</dd>
              <dt className="text-muted-foreground">{t('検出')}</dt>
              <dd className="font-medium">{install.state.device.chip}</dd>
              <dt className="text-muted-foreground">{t('バージョン')}</dt>
              <dd className="font-medium">{install.state.device.firmwareVersion}</dd>
            </dl>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel onClick={install.cancel}>{t('キャンセル')}</AlertDialogCancel>
            <AlertDialogAction onClick={install.confirm}>{t('書き込む')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
