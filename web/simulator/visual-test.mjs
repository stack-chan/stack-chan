import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { chromium } from 'playwright-core'

import { resolveChromium, startPreview } from '../test-preview-server.mjs'

if (!existsSync('simulator/mc.js') || !existsSync('simulator/mc.wasm')) {
  console.log('WASM simulator visual test skipped: run firmware npm run build:wasm first')
  process.exit(0)
}

const port = Number(process.env.STACKCHAN_SIMULATOR_TEST_PORT ?? 8098)
const executablePath = resolveChromium()
const { baseUrl, server } = await startPreview({
  port,
  url: process.env.STACKCHAN_SIMULATOR_TEST_URL,
})

let browser
try {
  browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--use-gl=swiftshader'],
  })
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await context.addInitScript(() => localStorage.setItem('stackchan.locale', 'ja'))
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const response = await page.goto(`${baseUrl}/simulator/`, { waitUntil: 'networkidle' })
  assert.equal(response?.ok(), true)
  await page.getByRole('region', { name: 'ｽﾀｯｸﾁｬﾝ3Dシミュレーター' }).waitFor()
  await page.getByText('シミュレーターを実行中').waitFor({ timeout: 45_000 })
  assert.equal(await page.locator('canvas[aria-label="ｽﾀｯｸﾁｬﾝ3Dシミュレーター"]').count(), 1)
  assert.equal(await page.getByRole('button', { name: 'カメラを接続' }).count(), 1)
  // A rendered shell can remain visible after the XS machine aborts.
  await page.waitForFunction(
    () => /app behaviors ready|XS abort|stack overflow|startup failed/i.test(document.body.innerText),
    undefined,
    { timeout: 45_000 }
  )
  const firmwareLog = await page.getByRole('log').innerText()
  console.log(firmwareLog)
  await page.screenshot({ path: '/tmp/stackchan-simulator-runtime.png', fullPage: true })
  assert.doesNotMatch(firmwareLog, /XS abort|stack overflow|startup failed/i)
  assert.ok(firmwareLog.includes('[main] app behaviors ready'), 'firmware startup must complete')
  assert.deepEqual(errors, [])
  await page.screenshot({ path: '/tmp/stackchan-simulator-runtime.png', fullPage: true })
} finally {
  await browser?.close()
  server?.kill('SIGTERM')
}
