import { type LucideIcon } from 'lucide-react'

import { useI18n } from '@/app/i18n-provider'
import { OperationStatus } from '@/components/stackchan/operation-status'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { type OperationState } from '@/features/operations/operation-state'
import { cn } from '@/lib/utils'
import { type ModDefinition } from '@/services/mod-gallery/mod-catalog-service'

export type ModAction = {
  label: string
  icon: LucideIcon
  href?: string
  external?: boolean
  onClick?: () => void
  variant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive'
}

export function ModCard({
  mod,
  badges,
  primaryAction,
  secondaryActions = [],
  operation = { status: 'idle' },
  selected = false,
}: {
  mod: ModDefinition
  badges: readonly string[]
  primaryAction?: ModAction
  secondaryActions?: readonly ModAction[]
  operation?: OperationState
  selected?: boolean
}) {
  const { t } = useI18n()
  const actions = primaryAction ? [primaryAction, ...secondaryActions] : secondaryActions
  const busy = operation.status === 'pending'
  const hasMiniApp = mod.entrypoints.includes('miniapp')
  const isCombinedPackage = hasMiniApp && mod.entrypoints.includes('mod')

  const renderAction = (action: ModAction, index: number) => {
    const Icon = action.icon
    const className = index === 0 ? 'sm:flex-1' : undefined
    const variant = action.variant ?? (index === 0 ? 'default' : 'outline')
    const control = action.href ? (
      <a
        className={cn(buttonVariants({ variant }), className, busy && 'pointer-events-none opacity-50')}
        href={busy ? undefined : action.href}
        target={action.external ? '_blank' : undefined}
        rel={action.external ? 'noopener noreferrer' : undefined}
        aria-disabled={busy || undefined}
        tabIndex={busy ? -1 : undefined}
      >
        <Icon data-icon="inline-start" />
        {action.label}
      </a>
    ) : (
      <Button className={className} variant={variant} disabled={busy} onClick={action.onClick}>
        <Icon data-icon="inline-start" />
        {action.label}
      </Button>
    )
    return <span key={`${action.label}-${index}`}>{control}</span>
  }

  return (
    <Card
      data-mod-id={mod.id}
      data-mod-type={mod.type}
      data-mod-entrypoints={mod.entrypoints.join(' ')}
      data-selected={selected || undefined}
      tabIndex={selected ? -1 : undefined}
      className={cn(
        'gap-4 transition-colors hover:border-primary/35',
        selected && 'border-primary ring-2 ring-primary/30'
      )}
    >
      <CardHeader className="grid grid-cols-[1fr_auto] gap-x-3">
        <div className="min-w-0">
          <CardTitle>{t(mod.name)}</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            v{mod.version} · {mod.author ?? t('作者不明')}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          {isCombinedPackage && <Badge variant="outline">MOD</Badge>}
          {hasMiniApp && <Badge>{t('ミニアプリ')}</Badge>}
          <Badge variant={mod.type === 'block' ? 'default' : 'secondary'}>
            {t(mod.type === 'block' ? 'ブロック' : 'テキスト')}
          </Badge>
        </div>
        <CardDescription className="col-span-full mt-3 leading-6">{t(mod.description)}</CardDescription>
      </CardHeader>
      <CardContent className="flex min-h-14 flex-wrap content-start gap-1.5">
        {badges.map((badge) => (
          <Badge key={badge} variant="outline">
            {badge}
          </Badge>
        ))}
      </CardContent>
      {operation.status !== 'idle' && (
        <CardContent>
          <OperationStatus
            state={operation}
            labels={{
              pending: t('処理中'),
              success: t('処理に成功しました'),
              cancelled: t('処理をキャンセルしました'),
              error: t('処理に失敗しました'),
            }}
          />
        </CardContent>
      )}
      {actions.length > 0 && (
        <CardFooter className="flex flex-wrap gap-2 border-t pt-4">{actions.map(renderAction)}</CardFooter>
      )}
    </Card>
  )
}
