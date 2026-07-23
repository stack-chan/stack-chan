import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'

const port = Number(process.env.STACKCHAN_PAGES_TEST_PORT ?? 8097)
const baseUrl = process.env.STACKCHAN_PAGES_TEST_URL ?? `http://127.0.0.1:${port}`
const executablePath = [
  process.env.CHROMIUM_PATH,
  '/snap/bin/chromium',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
].find((candidate) => candidate && existsSync(candidate))
if (!executablePath) throw new Error('Chromium executable not found; set CHROMIUM_PATH')

let server
if (!process.env.STACKCHAN_PAGES_TEST_URL) {
  server = spawn(
    resolve('node_modules/.bin/vite'),
    ['preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { cwd: process.cwd(), stdio: 'inherit' }
  )
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      if ((await fetch(baseUrl)).ok) return
    } catch {}
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
  }
  throw new Error(`Vite preview did not start at ${baseUrl}`)
}

const pages = [
  ['home', '/'],
  ['flash', '/flash/'],
  ['preference', '/preference/'],
  ['mod-gallery', '/mod-gallery/'],
  ['editor', '/editor/'],
  ['tutorial', '/editor/tutorial.html'],
  ['face-editor', '/face-editor/'],
  ['simulator', '/simulator/'],
]
const viewports = [
  ['desktop', 1280, 800],
  ['tablet', 768, 900],
  ['mobile', 390, 844],
]

let browser
try {
  await waitForServer()
  browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--use-gl=swiftshader'],
  })
  const context = await browser.newContext()
  await context.addInitScript(() => {
    if (!localStorage.getItem('stackchan.locale')) localStorage.setItem('stackchan.locale', 'ja')
    if (!localStorage.getItem('stackchan.theme')) localStorage.setItem('stackchan.theme', 'light')
  })
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error))

  for (const [viewportName, width, height] of viewports) {
    await page.setViewportSize({ width, height })
    for (const [pageName, pathname] of pages) {
      if (viewportName !== 'desktop' && pageName === 'simulator') continue
      pageErrors.length = 0
      const response = await page.goto(`${baseUrl}${pathname}`, {
        waitUntil: 'networkidle',
      })
      assert.equal(response?.ok(), true, `${pageName} should return a successful response`)
      await page.locator('header').first().waitFor()
      const layout = await page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        unnamedControls: [...document.querySelectorAll('button, a[href], input, select')].filter(
          (element) =>
            element.getClientRects().length > 0 &&
            element.getAttribute('aria-hidden') !== 'true' &&
            !(
              element.getAttribute('aria-label') ||
              ('labels' in element && element.labels?.length) ||
              element.getAttribute('title') ||
              element.textContent?.trim() ||
              element.getAttribute('placeholder')
            )
        ).length,
      }))
      assert.ok(
        layout.documentWidth <= layout.viewportWidth + 1,
        `${pageName}/${viewportName} must not overflow horizontally`
      )
      assert.equal(
        layout.unnamedControls,
        0,
        `${pageName}/${viewportName} must give every visible control an accessible name`
      )
      assert.deepEqual(
        pageErrors.map((error) => error.message),
        [],
        `${pageName}/${viewportName} must not raise uncaught errors`
      )
      await page.screenshot({
        path: `/tmp/stackchan-${pageName}-${viewportName}.png`,
        fullPage: pageName !== 'editor',
      })
    }
  }

  await page.goto(`${baseUrl}/flash/`, { waitUntil: 'networkidle' })
  assert.equal(await page.locator('esp-web-install-button').count(), 0)
  assert.equal(await page.getByRole('button', { name: 'USBに接続して書き込む' }).count(), 1)

  await page.goto(`${baseUrl}/editor/`, { waitUntil: 'networkidle' })
  const buildButton = page.getByRole('button', { name: 'ビルド', exact: true })
  await buildButton.waitFor()
  assert.equal(await buildButton.isEnabled(), true, 'the default visual project must be buildable')
  await buildButton.click()
  await page.getByText('ビルドに成功しました').waitFor({ timeout: 30_000 })
  assert.equal(
    await page.getByRole('button', { name: 'ダウンロード' }).isEnabled(),
    true,
    'a browser build must produce a downloadable MOD archive'
  )

  await page.evaluate(() => localStorage.setItem('stackchan.theme', 'dark'))
  await page.reload({ waitUntil: 'networkidle' })
  assert.equal(await page.locator('html.dark').count(), 1, 'saved dark theme must apply before app interaction')
} finally {
  await browser?.close()
  server?.kill('SIGTERM')
}
