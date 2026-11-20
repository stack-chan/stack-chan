import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'

import { resolveChromium, startPreview } from './test-preview-server.mjs'

const port = Number(process.env.STACKCHAN_I18N_TEST_PORT ?? 8099)
const executablePath = resolveChromium()
const { baseUrl, server } = await startPreview({
  port,
  url: process.env.STACKCHAN_I18N_TEST_URL,
})
const locales = ['ja', 'en', 'zh-CN']
const homeHeadingKey = 'ｽﾀｯｸﾁｬﾝ Webツール'
const galleryDescriptionKey = '公開済みMODを試して編集する'
const expectedText = Object.fromEntries(
  await Promise.all(
    locales.map(async (locale) => {
      const catalog = JSON.parse(await readFile(new URL(`./locales/${locale}.json`, import.meta.url), 'utf8'))
      return [
        locale,
        {
          heading: catalog[homeHeadingKey],
          galleryDescription: catalog[galleryDescriptionKey],
        },
      ]
    })
  )
)

let browser
try {
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] })
  const page = await browser.newPage()
  for (const locale of locales) {
    await page.goto(baseUrl)
    await page.evaluate((value) => localStorage.setItem('stackchan.locale', value), locale)
    await page.reload({ waitUntil: 'networkidle' })
    assert.equal(await page.locator('html').getAttribute('lang'), locale)
    assert.equal((await page.locator('h1').first().innerText()).trim(), expectedText[locale].heading)
    const galleryCard = page.getByRole('link', { name: /MOD Gallery/ })
    assert.equal((await galleryCard.locator('small').innerText()).trim(), expectedText[locale].galleryDescription)
    await page.screenshot({ path: `/tmp/stackchan-i18n-${locale}.png`, fullPage: true })
  }
} finally {
  await browser?.close()
  server?.kill('SIGTERM')
}
