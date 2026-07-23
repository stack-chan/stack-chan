import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'

if (!existsSync('simulator/mc.js') || !existsSync('simulator/mc.wasm')) {
  console.log('WASM simulator visual test skipped: run firmware npm run build:wasm first')
  process.exit(0)
}

const port = Number(process.env.STACKCHAN_SIMULATOR_TEST_PORT ?? 8098)
const baseUrl = process.env.STACKCHAN_SIMULATOR_TEST_URL ?? `http://127.0.0.1:${port}`
const executablePath = [
  process.env.CHROMIUM_PATH,
  '/snap/bin/chromium',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
].find((candidate) => candidate && existsSync(candidate))
if (!executablePath) throw new Error('Chromium executable not found; set CHROMIUM_PATH')

let server
if (!process.env.STACKCHAN_SIMULATOR_TEST_URL) {
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
  assert.equal(await page.locator('canvas[aria-label="3D Stack-chan simulator"]').count(), 1)
  assert.equal(await page.getByRole('button', { name: 'カメラを接続' }).count(), 1)
  assert.deepEqual(errors, [])
  await page.screenshot({ path: '/tmp/stackchan-simulator-runtime.png', fullPage: true })
} finally {
  await browser?.close()
  server?.kill('SIGTERM')
}
