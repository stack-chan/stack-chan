import { Bluetooth, Camera, CameraOff, Cpu, Download, Info, Unlink } from 'lucide-react'

import { useI18n } from '@/app/i18n-provider'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  type MediaPipeTrackingDependencies,
  type TrackingActivityStatus,
  type TrackingHand,
  useMediaPipeTracking,
} from '@/features/mediapipe/use-mediapipe-tracking'
import { cn } from '@/lib/utils'

type MediaPipePageProps = {
  dependencies?: Partial<MediaPipeTrackingDependencies>
}

const statusColor: Record<TrackingActivityStatus['state'], string> = {
  idle: 'text-muted-foreground',
  busy: 'text-warning',
  connected: 'text-success',
  error: 'text-destructive',
}

export function MediaPipePage({ dependencies }: MediaPipePageProps) {
  const { t } = useI18n()
  const tracking = useMediaPipeTracking(dependencies)

  const translateStatus = (status: TrackingActivityStatus) => {
    const params = status.params ? { ...status.params } : undefined
    if (params && typeof params.error === 'string') params.error = t(params.error)
    return t(status.message, params)
  }

  const formatHand = (hand: TrackingHand | null) =>
    hand
      ? t('{count}本 / 向き{variant} ({x}, {y})', {
          count: hand.fingerCount === 3 ? '3+' : hand.fingerCount,
          variant: hand.variant,
          x: hand.x.toFixed(2),
          y: hand.y.toFixed(2),
        })
      : t('未検出')

  const face = tracking.trackingState.face
  const faceValue = face
    ? t('yaw {yaw} / pitch {pitch} / 目 {leftEye}, {rightEye} / 口 {mouth}', {
        yaw: face.yaw.toFixed(2),
        pitch: face.pitch.toFixed(2),
        leftEye: face.eyeOpen?.left.toFixed(2) ?? '-',
        rightEye: face.eyeOpen?.right.toFixed(2) ?? '-',
        mouth: face.mouthOpen?.toFixed(2) ?? '-',
      })
    : t('未検出')

  const statusLine = (id: string, status: TrackingActivityStatus) => (
    <p
      id={id}
      className={cn('min-h-5 text-sm', statusColor[status.state])}
      data-state={status.state}
      role="status"
      aria-live="polite"
    >
      {translateStatus(status)}
    </p>
  )

  return (
    <div className="page-container grid gap-6">
      <header className="flex flex-col items-start justify-between gap-5 lg:flex-row lg:items-end">
        <div>
          <p className="mb-2 text-xs font-semibold tracking-widest text-primary uppercase">Web Bluetooth demo</p>
          <h1 id="page-title" className="page-heading">
            {t('顔と手をｽﾀｯｸﾁｬﾝへ映す')}
          </h1>
          <p className="page-lead">
            {t(
              'カメラ映像をブラウザ内のMediaPipeで解析し、顔向き、笑顔、左右の目と口の開き、顔に対する手の位置、手の向きと指の本数をBLEで送ります。'
            )}
          </p>
        </div>
        <Button
          id="install-mod-link"
          size="lg"
          render={<a href="../mod-gallery/?mod=tech.stackchan.samples.mediapipe-ble" />}
        >
          <Download data-icon="inline-start" />
          {t('受信MODをインストール')}
        </Button>
      </header>

      <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="min-w-0 gap-0 py-0">
          <CardHeader className="gap-4 border-b py-4 sm:flex sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle id="camera-heading">{t('カメラ')}</CardTitle>
              <CardDescription>{statusLine('camera-status', tracking.cameraStatus)}</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                id="camera-button"
                onClick={() => void tracking.startCamera()}
                disabled={!tracking.cameraSupported || tracking.cameraActive || tracking.cameraStatus.state === 'busy'}
              >
                <Camera data-icon="inline-start" />
                {t('カメラ開始')}
              </Button>
              <Button
                id="camera-stop-button"
                variant="outline"
                onClick={tracking.stopCamera}
                disabled={!tracking.cameraActive}
              >
                <CameraOff data-icon="inline-start" />
                {t('停止')}
              </Button>
            </div>
          </CardHeader>
          <div
            className="relative aspect-video min-h-64 overflow-hidden rounded-b-xl bg-black"
            aria-labelledby="camera-heading"
          >
            <video
              id="camera-video"
              ref={tracking.videoRef}
              className="absolute inset-0 size-full object-cover [transform:scaleX(-1)]"
              playsInline
              muted
            />
            <canvas
              id="tracking-canvas"
              ref={tracking.canvasRef}
              className="pointer-events-none absolute inset-0 size-full object-cover [transform:scaleX(-1)]"
              aria-hidden="true"
            />
            <Badge
              id="tracking-status"
              variant="outline"
              className="absolute right-3 bottom-3 h-auto max-w-[calc(100%-1.5rem)] border-white/15 bg-black/75 px-2.5 py-1.5 text-center text-xs text-white"
              role="status"
              aria-live="polite"
            >
              {t(tracking.trackingStatus)}
            </Badge>
          </div>
        </Card>

        <aside className="grid gap-4 lg:sticky lg:top-22">
          <Card>
            <CardHeader>
              <CardTitle id="ble-heading">{t('BLE接続')}</CardTitle>
              <CardDescription>{statusLine('ble-status', tracking.bleStatus)}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <Button
                id="ble-button"
                onClick={() => void tracking.connectBle()}
                disabled={!tracking.bluetoothSupported || tracking.bleConnected || tracking.bleStatus.state === 'busy'}
              >
                <Bluetooth data-icon="inline-start" />
                {t('ｽﾀｯｸﾁｬﾝへ接続')}
              </Button>
              <Button
                id="ble-disconnect-button"
                variant="outline"
                onClick={tracking.disconnectBle}
                disabled={!tracking.bleConnected}
              >
                <Unlink data-icon="inline-start" />
                {t('切断')}
              </Button>
              <p className="text-xs leading-5 text-muted-foreground">
                {t('先に受信MODをCoreS3へ書き込み、MODが起動してから接続してください。ChromeまたはEdgeが必要です。')}
              </p>
              <Button variant="link" className="justify-start px-0" render={<a href="../flash/" />}>
                <Cpu data-icon="inline-start" />
                {t('対応ファームウェアを書き込む')}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle id="values-heading">{t('認識値')}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid text-sm" aria-labelledby="values-heading">
                {[
                  [t('顔向き'), faceValue, 'face-value'],
                  [t('表情'), face?.emotion === 'happy' ? t('笑顔') : face ? t('真顔') : t('未検出'), 'emotion-value'],
                  [t('左手'), formatHand(tracking.trackingState.hands.left), 'left-hand-value'],
                  [t('右手'), formatHand(tracking.trackingState.hands.right), 'right-hand-value'],
                ].map(([label, value, id]) => (
                  <div
                    key={id}
                    className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3 border-t py-2.5 first:border-t-0 first:pt-0 last:pb-0"
                  >
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd id={id} className="min-w-0 [overflow-wrap:anywhere]">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>

          <Alert role="note">
            <Info aria-hidden="true" />
            <AlertTitle>{t('映像について')}</AlertTitle>
            <AlertDescription className="grid gap-2">
              <p>{t('カメラ映像は端末内で解析され、ｽﾀｯｸﾁｬﾝへは数値化した追跡結果だけが送られます。')}</p>
              <p>{t('デモ起動時に、固定バージョンのMediaPipe実行コードと学習済みモデルを外部CDNから取得します。')}</p>
            </AlertDescription>
          </Alert>
        </aside>
      </div>
    </div>
  )
}
