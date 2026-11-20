import { Languages, Menu, MonitorCog, Moon, Sun } from 'lucide-react'
import { type ReactNode } from 'react'

import { useI18n } from '@/app/i18n-provider'
import { GUIDE_NAVIGATION_ITEMS, TOOL_NAVIGATION_ITEMS, type NavigationId } from '@/app/navigation'
import { useTheme } from '@/app/theme-provider'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { type Locale } from '@/lib/i18n/catalogs'
import { type Theme } from '@/lib/theme/theme'

const symbolUrl = new URL('../../assets/stackchan-symbol.png', import.meta.url).href

type AppShellProps = {
  current: NavigationId
  surfaceName: string
  rootHref: string
  children: ReactNode
  headerActions?: ReactNode
  contentClassName?: string
}

const localeNames: Record<Locale, string> = {
  ja: '日本語',
  en: 'English',
  'zh-CN': '简体中文',
}

export function AppShell({ current, surfaceName, rootHref, children, headerActions, contentClassName }: AppShellProps) {
  const { locale, setLocale, t } = useI18n()
  const { theme, setTheme } = useTheme()
  const rootUrl = new URL(rootHref, window.location.href)
  const hrefFor = (href: string) => new URL(href, rootUrl).href

  const navigationSection = (label: string, items: typeof TOOL_NAVIGATION_ITEMS | typeof GUIDE_NAVIGATION_ITEMS) => (
    <section className="space-y-2">
      <h2 className="px-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">{t(label)}</h2>
      <nav aria-label={t(label)} className="grid gap-1">
        {items.map((item) => {
          const Icon = item.icon
          const active = item.id === current
          return (
            <a
              key={item.id}
              href={hrefFor(item.href)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'grid min-h-14 grid-cols-[2rem_1fr] items-center gap-3 rounded-lg border border-transparent px-3 py-2 text-sm transition-colors',
                active ? 'border-border bg-accent text-accent-foreground shadow-xs' : 'hover:bg-muted'
              )}
            >
              <Icon className="size-5 text-primary" aria-hidden="true" />
              <span className="min-w-0">
                <strong className="block truncate font-medium">{t(item.label)}</strong>
                <small className="block truncate text-xs text-muted-foreground">{t(item.description)}</small>
              </span>
            </a>
          )
        })}
      </nav>
    </section>
  )

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-40 flex h-16 items-center gap-2 border-b bg-background/95 px-2 backdrop-blur sm:gap-3 sm:px-5">
        <Sheet>
          <SheetTrigger
            render={
              <Button variant="ghost" size="icon" aria-label={t('ツールメニューを開く')} title={t('ツールメニュー')} />
            }
          >
            <Menu aria-hidden="true" />
          </SheetTrigger>
          <SheetContent side="left" closeLabel={t('閉じる')} className="w-[min(23rem,calc(100vw-2rem))]">
            <SheetHeader className="border-b">
              <SheetTitle>{t('Webツール')}</SheetTitle>
              <SheetDescription>Stack-chan</SheetDescription>
            </SheetHeader>
            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-7 p-4">
                {navigationSection('ツール', TOOL_NAVIGATION_ITEMS)}
                {navigationSection('ガイド', GUIDE_NAVIGATION_ITEMS)}
                <section className="space-y-3 border-t pt-5">
                  <div className="grid grid-cols-[1.5rem_1fr] items-center gap-2">
                    <Languages className="size-4 text-muted-foreground" aria-hidden="true" />
                    <label className="text-sm font-medium" htmlFor="tool-language-select">
                      {t('表示言語')}
                    </label>
                  </div>
                  <Select value={locale} onValueChange={(value) => value && setLocale(value as Locale)}>
                    <SelectTrigger id="tool-language-select" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(localeNames).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          <span translate="no">{label}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="grid grid-cols-[1.5rem_1fr] items-center gap-2 pt-2">
                    {theme === 'light' ? (
                      <Sun className="size-4 text-muted-foreground" aria-hidden="true" />
                    ) : theme === 'dark' ? (
                      <Moon className="size-4 text-muted-foreground" aria-hidden="true" />
                    ) : (
                      <MonitorCog className="size-4 text-muted-foreground" aria-hidden="true" />
                    )}
                    <label className="text-sm font-medium" htmlFor="tool-theme-select">
                      {t('テーマ')}
                    </label>
                  </div>
                  <Select value={theme} onValueChange={(value) => value && setTheme(value as Theme)}>
                    <SelectTrigger id="tool-theme-select" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="light">{t('ライト')}</SelectItem>
                      <SelectItem value="dark">{t('ダーク')}</SelectItem>
                      <SelectItem value="system">{t('システム設定')}</SelectItem>
                    </SelectContent>
                  </Select>
                </section>
              </div>
            </ScrollArea>
          </SheetContent>
        </Sheet>
        <a className="flex min-w-0 flex-1 items-center gap-2 font-semibold tracking-tight" href={hrefFor('')}>
          <img className="size-8 rounded-md" src={symbolUrl} alt="" width="32" height="32" />
          <span className="truncate">
            ｽﾀｯｸﾁｬﾝ
            <span className="ml-1 font-normal text-muted-foreground">{t(surfaceName)}</span>
          </span>
        </a>
        {headerActions && <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">{headerActions}</div>}
      </header>
      <main className={contentClassName}>{children}</main>
    </div>
  )
}
