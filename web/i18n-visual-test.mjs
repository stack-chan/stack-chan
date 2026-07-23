import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'

const port = Number(process.env.STACKCHAN_I18N_TEST_PORT ?? 8099)
const baseUrl = process.env.STACKCHAN_I18N_TEST_URL ?? `http://127.0.0.1:${port}`
const executablePath = [
  process.env.CHROMIUM_PATH,
  '/snap/bin/chromium',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
].find((candidate) => candidate && existsSync(candidate))
if (!executablePath) throw new Error('Chromium executable not found; set CHROMIUM_PATH')

let server
if (!process.env.STACKCHAN_I18N_TEST_URL) {
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

let browser
try {
  await waitForServer()
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] })
  const page = await browser.newPage()
  const expectedHeadings = {
    ja: 'ｽﾀｯｸﾁｬﾝ Webツール',
    en: 'Stack-chan Web Tools',
    'zh-CN': 'Stack-chan Web工具',
  }
  for (const locale of ['ja', 'en', 'zh-CN']) {
    await page.goto(baseUrl)
    await page.evaluate((value) => localStorage.setItem('stackchan.locale', value), locale)
    await page.reload({ waitUntil: 'networkidle' })
    assert.equal(await page.locator('html').getAttribute('lang'), locale)
    assert.equal((await page.locator('h1').innerText()).trim(), expectedHeadings[locale])
    await page.screenshot({ path: `/tmp/stackchan-i18n-${locale}.png`, fullPage: true })
  }
} finally {
  await browser?.close()
  server?.kill('SIGTERM')
}
