import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'

const port = Number(process.env.STACKCHAN_I18N_TEST_PORT ?? 18097)
const baseUrl = process.env.STACKCHAN_I18N_TEST_URL ?? `http://127.0.0.1:${port}`
const executablePath = [
  process.env.CHROMIUM_PATH,
  '/snap/bin/chromium',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
].find((candidate) => candidate && existsSync(candidate))
if (!executablePath) throw new Error('Chromium executable not found; set CHROMIUM_PATH')
const englishCatalog = JSON.parse(readFileSync(new URL('./locales/en.json', import.meta.url)))

const pages = [
  ['home', '/', '#launcher-heading', { en: 'Stack-chan Web Tools', 'zh-CN': 'Stack-chan Web工具' }],
  ['flash', '/flash/', '#flash-heading', { en: 'Firmware Installer', 'zh-CN': '固件烧录' }],
  ['preference', '/preference/', '.connection-pane h1', { en: 'Device Settings', 'zh-CN': '设备设置' }],
  ['simulator', '/simulator/', '#camera-heading', { en: 'Camera', 'zh-CN': '摄像头' }],
  ['editor', '/editor/', '#asset-section-heading', { en: 'Assets', 'zh-CN': '资源' }],
  [
    'tutorial',
    '/editor/tutorial.html',
    '.tutorial-hero h1',
    { en: 'Build it, run it, then make it your own', 'zh-CN': '创建、运行，再逐步扩展' },
  ],
  ['face-editor', '/face-editor/', '.topbar .surface-name', { en: 'Shape Face Editor', 'zh-CN': 'Shape Face编辑器' }],
]

let server
if (!process.env.STACKCHAN_I18N_TEST_URL) {
  server = spawn(process.execPath, [resolve('static-server.mjs'), `--port=${port}`, '--host=127.0.0.1'], {
    cwd: process.cwd(),
    stdio: 'inherit',
  })
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(baseUrl)).ok) return
    } catch {}
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
  }
  throw new Error(`i18n test server did not start at ${baseUrl}`)
}

let browser
try {
  await waitForServer()
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] })
  const context = await browser.newContext()
  const page = await context.newPage()
  const browserErrors = []
  page.on('pageerror', (error) => browserErrors.push(error.message))
  await page.addInitScript(() => {
    if (!('serial' in navigator)) {
      Object.defineProperty(navigator, 'serial', {
        configurable: true,
        value: {
          requestPort: () => Promise.reject(new Error('WebSerial is not used by i18n tests')),
        },
      })
    }
  })

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.setItem('stackchan.locale', 'ja'))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tool-menu-button')

  async function selectLocale(locale) {
    await page.locator('.tool-menu-button').click()
    await page.locator('#tool-drawer[open]').waitFor({ state: 'visible' })
    assert.deepEqual(await page.locator('#tool-language-select option').allTextContents(), [
      '日本語',
      'English',
      '简体中文',
    ])
    const navigation = page.waitForEvent('framenavigated', {
      predicate: (frame) => frame === page.mainFrame(),
    })
    await page.locator('#tool-language-select').selectOption(locale)
    await navigation
    await page.waitForSelector('.tool-menu-button')
    assert.equal(await page.evaluate(() => document.documentElement.lang), locale)
    assert.equal(await page.evaluate(() => localStorage.getItem('stackchan.locale')), locale)
  }

  for (const locale of ['en', 'zh-CN']) {
    await selectLocale(locale)
    for (const [pageName, pathname, selector, expected] of pages) {
      await page.goto(`${baseUrl}${pathname}`, { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('.tool-menu-button')
      assert.equal(
        (await page.locator(selector).innerText()).trim(),
        expected[locale],
        `${pageName}: representative UI text must be localized for ${locale}`
      )
      assert.equal(
        await page.evaluate(() => document.documentElement.lang),
        locale,
        `${pageName}: document language must be ${locale}`
      )
      if (locale === 'en') {
        const untranslated = await page.evaluate((catalog) => {
          const skipped = (element) =>
            !element || element.closest('[translate="no"], code, pre, script, style, .blocklySvg, #trace-log')
          const visible = (element) => element.getClientRects().length > 0
          const values = []
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
          while (walker.nextNode()) {
            const element = walker.currentNode.parentElement
            const value = walker.currentNode.nodeValue?.trim()
            if (!value || skipped(element) || !visible(element)) continue
            if (Object.hasOwn(catalog, value) && catalog[value] !== value) values.push(value)
          }
          for (const element of document.querySelectorAll('[aria-label], [placeholder], [title]')) {
            if (skipped(element) || !visible(element)) continue
            for (const attribute of ['aria-label', 'placeholder', 'title']) {
              const value = element.getAttribute(attribute)?.trim()
              if (value && Object.hasOwn(catalog, value) && catalog[value] !== value)
                values.push(`${attribute}: ${value}`)
            }
          }
          return [...new Set(values)]
        }, englishCatalog)
        assert.deepEqual(untranslated, [], `${pageName}: visible cataloged UI must not remain in Japanese`)
      }
    }
  }

  assert.deepEqual(browserErrors, [], 'localized pages must not raise browser errors')
  await context.close()
  console.log('i18n browser checks passed for English and Simplified Chinese across all Web tools')
} finally {
  await browser?.close()
  server?.kill('SIGTERM')
}
