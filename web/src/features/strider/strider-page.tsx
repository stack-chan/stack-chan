import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Bluetooth, Square } from 'lucide-react'
import { type KeyboardEvent, type MouseEvent, type PointerEvent, useCallback, useEffect, useRef, useState } from 'react'

import { useI18n } from '@/app/i18n-provider'
import { Button } from '@/components/ui/button'
import { type DriveAction, DriveSender } from '@/features/strider/drive-sender'
import { cn } from '@/lib/utils'
import BLELocalPeerCapability from '../../../local-peer/ble-local-peer.mjs'

type Session = Awaited<ReturnType<BLELocalPeerCapability['open']>>
type Link = {
  session?: Session
  sender?: DriveSender
  timeout?: number
  peer?: PeerState
}
type Hold = { action: DriveAction } & ({ pointerId: number } | { key: string })
type LinkStatus = keyof typeof linkLabels
type PeerStatus = keyof typeof peerLabels
type PeerState = { status: PeerStatus; calibrated: boolean; reason?: string; gesture?: number }

const linkLabels = {
  disconnected: 'Bluetooth接続を押し、Strider MODを起動したSTKを選んでください。',
  opening: 'Bluetoothに接続しています…',
  waiting: 'Strider MODの応答を待っています…',
  connected: 'Bluetooth接続済み',
  closing: '切断しています…',
  lost: 'Bluetooth接続が切れました',
  failed: '接続できませんでした。もう一度お試しください。',
  noMod: 'Strider MODから応答がありません。導入済みの本体を選んでください。',
  sendFailed: '指令を送信できませんでした。接続し直してください。',
  unsupported: 'Web Bluetoothに対応したブラウザーでHTTPSページを開いてください。',
} as const

const peerLabels = {
  ready: '操作できます',
  'needs-calibration': '旋回するには調整してください',
  calibrating: '調整中。完了まで押し続けてください。',
  calibrated: '旋回調整済み',
  error: '動作を停止しました。足回りを確認してからやり直してください。',
} as const

const errorLabels: Record<string, string> = {
  'gyro-unavailable': 'ジャイロを利用できません。旋回を調整できません。',
  'stop-failed': '停止を確認できません。本体の電源を切ってください。',
  'motion-unavailable': 'この本体では連続回転を利用できません。',
  'calibration-save-failed': '旋回の調整を保存できませんでした。もう一度調整してください。',
}

const directions = [
  { action: 'forward', label: '前進', icon: ArrowUp, position: 'col-start-2 row-start-1' },
  { action: 'left', label: '左旋回', icon: ArrowLeft, position: 'col-start-1 row-start-2' },
  { action: 'right', label: '右旋回', icon: ArrowRight, position: 'col-start-3 row-start-2' },
  { action: 'backward', label: '後退', icon: ArrowDown, position: 'col-start-2 row-start-3' },
] as const

function readPeerState(payload: unknown): PeerState | undefined {
  if (typeof payload !== 'object' || payload === null || !('status' in payload)) return
  const { status } = payload
  if (typeof status !== 'string' || !Object.hasOwn(peerLabels, status)) return
  const gesture = 'gesture' in payload ? payload.gesture : undefined
  return {
    status: status as PeerStatus,
    calibrated: 'calibrated' in payload ? payload.calibrated === true : status === 'calibrated',
    reason: 'reason' in payload && typeof payload.reason === 'string' ? payload.reason : undefined,
    gesture: typeof gesture === 'number' && Number.isSafeInteger(gesture) && gesture > 0 ? gesture : undefined,
  }
}

export function StriderPage() {
  const { t } = useI18n()
  const [status, setStatus] = useState<LinkStatus>('disconnected')
  const [peer, setPeer] = useState<PeerState>()
  const [heldAction, setHeldAction] = useState<DriveAction>()
  const [power, setPower] = useState(60)
  const link = useRef<Link>(null)
  const hold = useRef<Hold>(null)
  const bluetoothSupported = window.isSecureContext && 'bluetooth' in navigator

  const clearHold = useCallback(() => {
    hold.current = null
    setHeldAction(undefined)
  }, [])

  const dropLink = useCallback(
    (current: Link, nextStatus: LinkStatus) => {
      if (link.current !== current) return
      link.current = null
      window.clearTimeout(current.timeout)
      current.sender?.close()
      current.session?.close()
      clearHold()
      setPeer(undefined)
      setStatus(nextStatus)
    },
    [clearHold]
  )

  const stop = useCallback(() => {
    clearHold()
    return link.current?.sender?.stop()
  }, [clearHold])

  useEffect(() => {
    const releaseHeld = () => {
      if (hold.current) void stop()
    }
    const onVisibilityChange = () => {
      if (document.hidden) releaseHeld()
    }
    const onPageHide = () => {
      if (link.current) dropLink(link.current, 'disconnected')
    }
    window.addEventListener('blur', releaseHeld)
    window.addEventListener('pagehide', onPageHide)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('blur', releaseHeld)
      window.removeEventListener('pagehide', onPageHide)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      onPageHide()
    }
  }, [dropLink, stop])

  async function connect() {
    if (link.current) return
    const current: Link = {}
    link.current = current
    setStatus('opening')
    try {
      const session = await new BLELocalPeerCapability().open({
        transport: 'ble',
        service: 'strider',
        displayName: 'Strider controls',
        selectDevice: true,
        onDisconnect: () => dropLink(current, 'lost'),
      })
      if (link.current !== current) {
        session.close()
        return
      }
      current.session = session
      setStatus('waiting')
      current.timeout = window.setTimeout(() => dropLink(current, 'noMod'), 3000)
      session.subscribe('state', ({ payload }: { payload: unknown }) => {
        if (link.current !== current) return
        const state = readPeerState(payload)
        if (!state) return
        if (!current.peer && current.sender) {
          window.clearTimeout(current.timeout)
          setStatus('connected')
        }
        if (current.sender?.stopForPeerState(state)) clearHold()
        current.peer = state
        setPeer(state)
      })
      await session.broadcast('state-request', null)
      if (link.current !== current) return
      current.sender = new DriveSender(session, () => dropLink(current, 'sendFailed'))
      if (current.peer) {
        window.clearTimeout(current.timeout)
        setStatus('connected')
      }
    } catch {
      dropLink(current, 'failed')
    }
  }

  function disconnect() {
    const current = link.current
    if (!current) return
    setStatus('closing')
    window.clearTimeout(current.timeout)
    current.timeout = window.setTimeout(() => dropLink(current, 'disconnected'), 300)
    void Promise.resolve(stop()).then(() => dropLink(current, 'disconnected'))
  }

  function start(nextHold: Hold) {
    if (status !== 'connected' || hold.current || document.hidden) return false
    if (!link.current?.sender?.start(nextHold.action, power / 100)) return false
    hold.current = nextHold
    setHeldAction(nextHold.action)
    return true
  }

  function holdEvents(action: DriveAction) {
    const releasePointer = (event: PointerEvent<HTMLButtonElement>) => {
      const active = hold.current
      if (active && 'pointerId' in active && active.pointerId === event.pointerId) void stop()
    }
    return {
      onPointerDown(event: PointerEvent<HTMLButtonElement>) {
        if (event.button !== 0 || !event.isPrimary) return
        if (start({ action, pointerId: event.pointerId })) event.currentTarget.setPointerCapture(event.pointerId)
      },
      onPointerUp: releasePointer,
      onPointerCancel: releasePointer,
      onLostPointerCapture: releasePointer,
      onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
        if (event.key !== ' ' && event.key !== 'Enter') return
        event.preventDefault()
        if (!event.repeat) start({ action, key: event.key })
      },
      onKeyUp(event: KeyboardEvent<HTMLButtonElement>) {
        const active = hold.current
        if (active && 'key' in active && active.key === event.key) void stop()
      },
      onBlur() {
        const active = hold.current
        if (active && 'key' in active) void stop()
      },
      onContextMenu(event: MouseEvent<HTMLButtonElement>) {
        event.preventDefault()
      },
    }
  }

  const connected = status === 'connected'
  const busy = status === 'opening' || status === 'closing'
  const canDisconnect = connected || status === 'waiting'
  const linkStatus = bluetoothSupported ? status : 'unsupported'

  return (
    <div className="mx-auto grid w-full max-w-lg gap-4 px-4 py-5 sm:gap-5 sm:px-6 sm:py-8">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div>
          <h1 className="page-heading">Strider</h1>
          <p className="mt-1 text-sm text-muted-foreground">M5StackChan K151</p>
        </div>
        <Button
          className="mt-0.5 min-h-11 px-3"
          variant={canDisconnect ? 'outline' : 'default'}
          disabled={busy || !bluetoothSupported}
          onClick={() => (canDisconnect ? disconnect() : void connect())}
        >
          <Bluetooth aria-hidden="true" />
          {t(canDisconnect || status === 'closing' ? '切断' : 'Bluetooth接続')}
        </Button>
        <p
          role="status"
          className={cn(
            'basis-full text-sm',
            linkStatus === 'connected' ? 'text-foreground' : 'text-muted-foreground',
            ['lost', 'failed', 'noMod', 'sendFailed'].includes(linkStatus) && 'text-destructive'
          )}
        >
          {t(linkLabels[linkStatus])}
        </p>
      </header>

      <section className="rounded-xl border bg-card p-4 sm:p-6" aria-label={t('歩行操作')}>
        <p className="mb-3 text-sm text-muted-foreground">{t('押している間だけ動きます。')}</p>
        <div className="mx-auto grid max-w-xs grid-cols-3 gap-2" role="group" aria-label={t('歩行操作')}>
          {directions.map(({ action, label, icon: Icon, position }) => {
            const isTurn = action === 'left' || action === 'right'
            const blocked = Boolean(heldAction && heldAction !== action)
            return (
              <Button
                key={action}
                variant={heldAction === action ? 'default' : 'outline'}
                className={cn('h-14 min-w-0 touch-none flex-col gap-1 sm:h-16', position)}
                disabled={!connected || blocked || (isTurn && !peer?.calibrated)}
                {...holdEvents(action)}
              >
                <Icon className="size-5" aria-hidden="true" />
                {t(label)}
              </Button>
            )
          })}
          <Button
            variant="destructive"
            className="col-start-2 row-start-2 h-14 min-w-0 touch-manipulation flex-col gap-1 sm:h-16"
            disabled={!connected}
            onPointerDown={(event) => {
              if (event.button === 0) void stop()
            }}
            onClick={(event) => {
              if (event.detail === 0) void stop()
            }}
          >
            <Square className="size-4 fill-current" aria-hidden="true" />
            {t('停止')}
          </Button>
        </div>
        <div className="mt-4 grid gap-1.5 border-t pt-3">
          <div className="flex justify-between gap-3 text-sm font-medium">
            <label htmlFor="strider-power">{t('歩行出力')}</label>
            <output htmlFor="strider-power" className="tabular-nums">
              {power}%
            </output>
          </div>
          <input
            className="h-7 w-full cursor-pointer accent-primary"
            id="strider-power"
            type="range"
            min="20"
            max="100"
            step="5"
            value={power}
            onChange={(event) => setPower(event.currentTarget.valueAsNumber)}
          />
        </div>
      </section>

      <section className="grid gap-2 border-t pt-3" aria-labelledby="strider-calibration">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="strider-calibration" className="text-sm font-semibold">
            {t('旋回の調整')}
          </h2>
          <Button
            variant={heldAction === 'calibrate' ? 'default' : 'outline'}
            className="min-h-11 touch-none px-3"
            disabled={!connected || Boolean(heldAction && heldAction !== 'calibrate')}
            {...holdEvents('calibrate')}
          >
            {t('押して調整')}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">{t('足回りを取り付け、前後に空きのある床に置いてください。')}</p>
        {peer && (
          <p
            role="status"
            className={cn('text-sm', peer.status === 'error' ? 'text-destructive' : 'text-muted-foreground')}
          >
            {t(
              peer.status === 'error' && peer.reason && Object.hasOwn(errorLabels, peer.reason)
                ? errorLabels[peer.reason]
                : peerLabels[peer.status]
            )}
          </p>
        )}
      </section>
    </div>
  )
}
