import { useEffect } from 'react'
import { AppShell } from '@/app/app-shell'
import { useI18n } from '@/app/i18n-provider'
import { mountApp } from '@/app/mount'
import { getGuides } from '@/features/guide/guide-content'
import { getModelContext } from '@/services/webmcp/runtime'
import '@/styles/globals.css'

function GuidePage() {
  const { locale, t } = useI18n()
  const guides = getGuides(locale)
  useEffect(() => {
    document.title = `${t('使い方・AI連携')} | ｽﾀｯｸﾁｬﾝ`
  }, [t])
  return (
    <AppShell current="guide" surfaceName="使い方・AI連携" rootHref="../">
      <div className="page-container grid max-w-5xl gap-8 py-8 md:grid-cols-[14rem_minmax(0,1fr)]">
        <nav aria-label={t('目次')} className="self-start md:sticky md:top-24">
          <h1 className="mb-4 text-xl font-semibold">{t('使い方・AI連携')}</h1>
          <ul className="grid gap-2 text-sm">
            {guides.map((guide) => (
              <li key={guide.id}>
                <a className="block rounded px-2 py-1.5 hover:bg-muted" href={`#${guide.id}`}>
                  {guide.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 divide-y">
          {guides.map((guide) => (
            <section key={guide.id} id={guide.id} className="scroll-mt-24 space-y-4 py-6 first:pt-0">
              <h2 className="text-lg font-semibold">{guide.title}</h2>
              <p className="text-sm leading-7">{guide.summary}</p>
              {guide.id === 'webmcp' && (
                <p role="status" className="text-sm font-medium">
                  {t(
                    getModelContext()
                      ? 'このブラウザで WebMCP を利用できます。'
                      : 'このブラウザでは WebMCP を利用できません。通常の画面操作は利用できます。'
                  )}
                </p>
              )}
              {guide.steps.length > 0 && (
                <ol className="list-decimal space-y-3 pl-5 text-sm leading-7">
                  {guide.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              )}
              {guide.prompts.map((prompt) => (
                <blockquote key={prompt} className="border-l-2 border-primary pl-4 text-sm leading-7">
                  {prompt}
                </blockquote>
              ))}
              {guide.href && (
                <a
                  className="inline-block text-sm text-primary underline underline-offset-4"
                  href={new URL(guide.href, new URL('../', location.href)).href}
                >
                  {guide.title} →
                </a>
              )}
              {guide.id === 'webmcp' && (
                <a className="text-sm text-primary underline" href="https://developer.chrome.com/docs/ai/webmcp">
                  Chrome WebMCP
                </a>
              )}
            </section>
          ))}
        </div>
      </div>
    </AppShell>
  )
}

mountApp(<GuidePage />)
