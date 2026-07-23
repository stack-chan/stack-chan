import { ArrowRight, Blocks, Box, Cpu, SlidersHorizontal, Smile, Store, type LucideIcon } from 'lucide-react'
import { useEffect } from 'react'

import { AppShell } from '@/app/app-shell'
import { useI18n } from '@/app/i18n-provider'
import { Card } from '@/components/ui/card'
import { mountApp } from '@/app/mount'
import '@/styles/globals.css'

const stackchanIconUrl = new URL('../../assets/stackchan-icon.png', import.meta.url).href

type Tool = {
  href: string
  label: string
  description: string
  icon: LucideIcon
}

const tools: Tool[] = [
  {
    href: 'flash/',
    label: 'ファームウェア書き込み',
    description: '対応ボードへUSB経由で書き込む',
    icon: Cpu,
  },
  {
    href: 'preference/',
    label: '設定',
    description: 'BLEで本体の設定を変更する',
    icon: SlidersHorizontal,
  },
  {
    href: 'mod-gallery/',
    label: 'MOD Gallery',
    description: '公開済みMODを試して編集する',
    icon: Store,
  },
  {
    href: 'simulator/',
    label: 'シミュレーター',
    description: 'WASMと3Dモデルを実行する',
    icon: Box,
  },
  {
    href: 'editor/',
    label: 'ブロックエディタ',
    description: 'MODを作成してインストールする',
    icon: Blocks,
  },
  {
    href: 'face-editor/',
    label: 'Shape顔エディタ',
    description: '目と口を配置してFace実装を作る',
    icon: Smile,
  },
]

function HomePage() {
  const { t } = useI18n()

  useEffect(() => {
    document.title = t('ｽﾀｯｸﾁｬﾝ Webツール')
  }, [t])

  return (
    <AppShell current="home" surfaceName="Webツール" rootHref="./">
      <div className="page-container grid min-h-[calc(100dvh-4rem)] place-items-center py-10">
        <div className="w-full max-w-4xl">
          <header className="mb-8 flex flex-col items-start gap-5 sm:flex-row sm:items-center">
            <img
              className="h-28 w-42 object-contain drop-shadow-lg"
              src={stackchanIconUrl}
              alt="ｽﾀｯｸﾁｬﾝ"
              width="240"
              height="160"
            />
            <div>
              <h1 className="page-heading">{t('ｽﾀｯｸﾁｬﾝ Webツール')}</h1>
              <p className="page-lead">{t('セットアップ、設定、開発をブラウザから行えます。')}</p>
            </div>
          </header>
          <nav className="grid gap-3 sm:grid-cols-2" aria-label={t('ツール一覧')}>
            {tools.map((tool) => {
              const Icon = tool.icon
              return (
                <Card key={tool.href} className="p-0 transition-colors hover:border-primary/50 hover:bg-accent/35">
                  <a className="grid min-h-24 grid-cols-[3rem_1fr_1.25rem] items-center gap-3 p-4" href={tool.href}>
                    <span className="grid size-11 place-items-center rounded-lg border bg-secondary text-primary">
                      <Icon className="size-5" aria-hidden="true" />
                    </span>
                    <span>
                      <strong className="block text-sm font-semibold">{t(tool.label)}</strong>
                      <small className="mt-1 block text-xs leading-5 text-muted-foreground">
                        {t(tool.description)}
                      </small>
                    </span>
                    <ArrowRight className="size-4 text-muted-foreground" aria-hidden="true" />
                  </a>
                </Card>
              )
            })}
          </nav>
        </div>
      </div>
    </AppShell>
  )
}

mountApp(<HomePage />)
