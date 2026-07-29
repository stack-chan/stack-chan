import { Blocks, FileCode2, Play, Search, Usb } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useI18n } from '@/app/i18n-provider'
import { ModCard } from '@/components/stackchan/mod-card'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { type OperationState } from '@/features/operations/operation-state'
import { toAppError } from '@/lib/errors/app-error'
import {
  fetchModArchive,
  loadGalleryCatalog,
  type ModArtifact,
  type ModDefinition,
} from '@/services/mod-gallery/mod-catalog-service'
import { inspectDeploymentCompatibility, profileFor } from '../../../editor/capabilities.mjs'
import { createEsptoolLoader, DEVICE_OPERATION_STATUS, installModToDevice } from '../../../editor/esptool-installer.mjs'
import { xsArchiveVersion } from '../../../editor/mod-builder.mjs'
import { createModStorage } from '../../../simulator/mod-storage.mjs'

type Filter = 'all' | 'block' | 'text'
type Operations = Record<string, OperationState>
type Confirmation = {
  mod: ModDefinition
  chip: string
  firmware: { projectName?: string; version: string }
  resolve: (approved: boolean) => void
}

type SerialNavigator = Navigator & {
  serial?: { requestPort: () => Promise<unknown> }
}

function formatDiagnostics(diagnostics: readonly { message: string }[]) {
  return diagnostics.map((item) => item.message).join(' / ')
}

function hasEntrypoint(mod: ModDefinition, entrypoint: 'mod' | 'miniapp') {
  return mod.entrypoints.includes(entrypoint)
}

export function ModGalleryPage() {
  const { t } = useI18n()
  const [definitions, setDefinitions] = useState<ModDefinition[]>([])
  const [query, setQuery] = useState('')
  const [type, setType] = useState<Filter>('all')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string>()
  const [operations, setOperations] = useState<Operations>({})
  const [confirmation, setConfirmation] = useState<Confirmation>()
  const confirmationRef = useRef<Confirmation | null>(null)
  const mounted = useRef(true)
  const requestedMod = useMemo(() => new URL(location.href).searchParams.get('mod'), [])

  useEffect(() => {
    mounted.current = true
    void loadGalleryCatalog()
      .then((catalog) => {
        if (mounted.current) setDefinitions(catalog)
      })
      .catch((error) => {
        if (mounted.current) setLoadError(toAppError(error, 'gallery-load').message)
      })
      .finally(() => {
        if (mounted.current) setLoading(false)
      })
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(
    () => () => {
      const pending = confirmationRef.current
      confirmationRef.current = null
      pending?.resolve(false)
    },
    []
  )

  useEffect(() => {
    if (loading || !requestedMod) return
    const selected = [...document.querySelectorAll<HTMLElement>('[data-mod-id]')].find(
      (candidate) => candidate.dataset.modId === requestedMod
    )
    if (!selected) return
    selected.focus({ preventScroll: true })
    selected.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [loading, requestedMod])

  const visible = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('ja')
    return definitions.filter((definition) => {
      if (type !== 'all' && definition.type !== type) return false
      const haystack = [definition.name, definition.description, ...definition.entrypoints, ...definition.capabilities]
        .join(' ')
        .toLocaleLowerCase('ja')
      return !normalizedQuery || haystack.includes(normalizedQuery)
    })
  }, [definitions, query, type])

  const setOperation = useCallback((id: string, operation: OperationState) => {
    setOperations((current) => ({ ...current, [id]: operation }))
  }, [])

  const requestConfirmation = useCallback(
    (value: Omit<Confirmation, 'resolve'>) => {
      const previous = confirmationRef.current
      previous?.resolve(false)
      if (previous) {
        setOperation(previous.mod.id, {
          status: 'cancelled',
          message: t('書き込みをキャンセルしました'),
        })
      }
      return new Promise<boolean>((resolve) => {
        const pending = { ...value, resolve }
        confirmationRef.current = pending
        setConfirmation(pending)
      })
    },
    [setOperation, t]
  )

  const resolveConfirmation = useCallback(
    (approved: boolean) => {
      const pending = confirmationRef.current
      confirmationRef.current = null
      setConfirmation(undefined)
      pending?.resolve(approved)
      if (!approved && pending) {
        setOperation(pending.mod.id, {
          status: 'cancelled',
          message: t('書き込みをキャンセルしました'),
        })
      }
    },
    [setOperation, t]
  )

  const run = useCallback(
    async (mod: ModDefinition, action: () => Promise<string>) => {
      setOperation(mod.id, { status: 'pending', message: t('アプリを準備しています') })
      try {
        const message = await action()
        setOperation(mod.id, { status: 'success', result: undefined, message })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'NotFoundError') {
          setOperation(mod.id, { status: 'cancelled', message: t('デバイスの選択をキャンセルしました') })
          return
        }
        setOperation(mod.id, { status: 'error', error: toAppError(error, 'mod-operation') })
      }
    },
    [setOperation, t]
  )

  const installToSimulator = useCallback(
    (mod: ModDefinition, artifact: ModArtifact) =>
      run(mod, async () => {
        const bytes = await fetchModArchive(artifact)
        const compatibility = inspectDeploymentCompatibility('simulator', {
          xsVersion: xsArchiveVersion(bytes),
          entrypoints: mod.entrypoints,
          requireArchive: true,
        })
        if (!compatibility.compatible) {
          throw new Error(formatDiagnostics(compatibility.diagnostics))
        }
        await createModStorage().saveInstalledMod({ name: `${mod.id}.xsa`, bytes })
        location.href = `../simulator/?gallery=${encodeURIComponent(mod.id)}`
        return t('シミュレーターへインストールしました')
      }),
    [run, t]
  )

  const installToDevice = useCallback(
    (mod: ModDefinition, artifact: ModArtifact) =>
      run(mod, async () => {
        const serial = (navigator as SerialNavigator).serial
        if (!serial) throw new Error(t('実機への書き込みにはChromeまたはEdgeを使ってください'))
        const bytes = await fetchModArchive(artifact)
        const archiveVersion = xsArchiveVersion(bytes)
        const port = await serial.requestPort()
        const result = await installModToDevice(createEsptoolLoader, port, bytes, {
          onPreflight: ({ chip, firmware }) => {
            const compatibility = inspectDeploymentCompatibility(artifact.target, {
              chip,
              xsVersion: archiveVersion,
              firmwareVersion: firmware.version,
              entrypoints: mod.entrypoints,
              requireArchive: true,
              requireFirmware: true,
            })
            if (!compatibility.compatible) {
              throw new Error(formatDiagnostics(compatibility.diagnostics))
            }
            return requestConfirmation({ mod, chip, firmware })
          },
          onProgress: (progress: number) =>
            setOperation(mod.id, {
              status: 'pending',
              message: t('アプリを実機へ書き込んでいます'),
              progress,
            }),
        })
        if (result.status === DEVICE_OPERATION_STATUS.CANCELLED) {
          throw new DOMException('cancelled', 'NotFoundError')
        }
        return t('アプリを実機へ書き込みました')
      }),
    [requestConfirmation, run, setOperation, t]
  )

  return (
    <>
      <div className="page-container">
        <header className="mb-8 max-w-3xl">
          <p className="mb-2 text-xs font-semibold tracking-widest text-primary uppercase">{t('使う、まねる、作る')}</p>
          <h1 className="page-heading">MOD Gallery</h1>
          <p className="page-lead">
            {t('公開されたMODやミニアプリを試したり、ブロックの作例から自分のMODを作ったりできます。')}
          </p>
        </header>

        <Card className="mb-5 grid gap-4 p-4 sm:grid-cols-[1fr_14rem]">
          <div className="grid gap-2">
            <Label htmlFor="mod-search">{t('検索')}</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="mod-search"
                type="search"
                className="pl-9"
                placeholder={t('名前や機能で検索')}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="type-filter">{t('作り方')}</Label>
            <Select value={type} onValueChange={(value) => value && setType(value as Filter)}>
              <SelectTrigger id="type-filter" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('すべて')}</SelectItem>
                <SelectItem value="block">{t('ブロック')}</SelectItem>
                <SelectItem value="text">{t('テキスト')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </Card>

        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
          <p aria-live="polite">
            {loading ? t('アプリを読み込んでいます') : t('{count}件のアプリ', { count: visible.length })}
          </p>
          <p>{t('ブロックは編集可能なサンプルです')}</p>
        </div>

        {loadError && (
          <Alert variant="destructive" className="mb-4">
            <AlertTitle>{t('MODを読み込めませんでした')}</AlertTitle>
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 md:grid-cols-2" aria-live="polite">
          {visible.map((mod) => {
            const isCombinedPackage = hasEntrypoint(mod, 'mod') && hasEntrypoint(mod, 'miniapp')
            const badges = [
              ...(isCombinedPackage ? [t('host権限を使用')] : []),
              ...mod.capabilities,
              ...mod.targets.map((target) => profileFor(target).label),
            ]
            if (mod.type === 'block') {
              const editorUrl = new URL('../editor/', location.href)
              editorUrl.searchParams.set('project', mod.sourceUrl.href)
              return (
                <ModCard
                  key={mod.id}
                  mod={mod}
                  selected={mod.id === requestedMod}
                  badges={badges}
                  operation={operations[mod.id]}
                  primaryAction={{
                    label: t('ブロックで開く'),
                    icon: Blocks,
                    href: editorUrl.href,
                  }}
                />
              )
            }
            const artifact = mod.artifacts[0]
            const supportsSimulator = mod.targets.includes('simulator')
            return (
              <ModCard
                key={mod.id}
                mod={mod}
                selected={mod.id === requestedMod}
                badges={badges}
                operation={operations[mod.id]}
                primaryAction={
                  artifact && supportsSimulator
                    ? {
                        label: t('シミュレーターで試す'),
                        icon: Play,
                        onClick: () => void installToSimulator(mod, artifact),
                      }
                    : undefined
                }
                secondaryActions={[
                  ...(artifact
                    ? [
                        {
                          label: t('実機へ書き込む'),
                          icon: Usb,
                          onClick: () => void installToDevice(mod, artifact),
                          variant: supportsSimulator ? ('outline' as const) : ('default' as const),
                        },
                      ]
                    : []),
                  {
                    label: t('ソースを見る'),
                    icon: FileCode2,
                    href: mod.sourceViewUrl.href,
                    variant: 'outline',
                  },
                ]}
              />
            )
          })}
        </div>
        {!loading && !loadError && visible.length === 0 && (
          <p className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
            {t('条件に合うMODがありません。')}
          </p>
        )}
      </div>

      <AlertDialog
        open={Boolean(confirmation)}
        onOpenChange={(open) => {
          if (!open && confirmation) resolveConfirmation(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('このデバイスへアプリを書き込みますか？')}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmation && t('「{name}」を接続中のｽﾀｯｸﾁｬﾝへ書き込みます。', { name: confirmation.mod.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {confirmation &&
            hasEntrypoint(confirmation.mod, 'mod') &&
            hasEntrypoint(confirmation.mod, 'miniapp') && (
              <Alert variant="destructive">
                <AlertTitle>{t('このpackageはhost権限を使用します')}</AlertTitle>
                <AlertDescription>
                  {t('MODとmini-appを含むため、package全体を信頼できる場合だけ書き込んでください。')}
                </AlertDescription>
              </Alert>
            )}
          {confirmation && (
            <dl className="grid grid-cols-[auto_1fr] gap-2 rounded-lg bg-muted p-3 text-sm">
              <dt className="text-muted-foreground">{t('検出')}</dt>
              <dd>{confirmation.chip}</dd>
              <dt className="text-muted-foreground">{t('ファームウェア')}</dt>
              <dd>{confirmation.firmware.version}</dd>
            </dl>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => resolveConfirmation(false)}>{t('キャンセル')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => resolveConfirmation(true)}>{t('書き込む')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
