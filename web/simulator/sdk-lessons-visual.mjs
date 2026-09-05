import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { resolveChromium, startPreview } from '../test-preview-server.mjs'

const allLessons = ['01-face', '02-tone', '03-input', '04-speech']
const requested = process.argv.slice(2)
assert.ok(
  requested.every((name) => allLessons.includes(name)),
  'Unknown lesson'
)
const lessons = requested.length ? requested : allLessons
const archives = lessons.map((name) => resolve(`../firmware/dist/bin/esp32/debug/${name}/${name}.xsa`))
for (const path of ['simulator/mc.js', 'simulator/mc.wasm', ...archives]) {
  assert.ok(existsSync(path), `Build the WASM host and lesson archives first: missing ${path}`)
}
const { baseUrl, server } = await startPreview({ port: Number(process.env.STACKCHAN_SDK_TEST_PORT ?? 8101) })
let browser
const messages = []
try {
  browser = await chromium.launch({
    executablePath: resolveChromium(),
    headless: true,
    args: ['--no-sandbox', '--use-gl=swiftshader', '--autoplay-policy=no-user-gesture-required'],
  })
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await context.addInitScript(() => {
    localStorage.setItem('stackchan.locale', 'ja')
    window.sdkLessonAudio = { tones: [], buffers: [] }
    const startTone = OscillatorNode.prototype.start
    OscillatorNode.prototype.start = function (...args) {
      window.sdkLessonAudio.tones.push(this.frequency.value)
      return startTone.apply(this, args)
    }
    const startBuffer = AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start = function (...args) {
      window.sdkLessonAudio.buffers.push(this.buffer?.length ?? 0)
      return startBuffer.apply(this, args)
    }
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    const text = message.text()
    messages.push(text)
    if (
      text.includes('XS abort') ||
      text.includes('[firmware:err]') ||
      text.includes('[main] error') ||
      text.includes('[app] ')
    )
      errors.push(text)
  })
  const ready = () =>
    page.waitForEvent('console', {
      predicate: (message) => message.text().includes('[main] app behaviors ready'),
      timeout: 45_000,
    })
  await Promise.all([ready(), page.goto(`${baseUrl}/simulator/`, { waitUntil: 'networkidle' })])
  for (let index = 0; index < lessons.length; index += 1) {
    await Promise.all([ready(), page.getByLabel('MODを追加', { exact: true }).setInputFiles(archives[index])])
    if (lessons[index] === '02-tone') {
      assert.ok(
        await page.evaluate(() => window.sdkLessonAudio.tones.includes(440)),
        'tone lesson must reach Web Audio'
      )
    }
    if (lessons[index] === '03-input') {
      await page.getByRole('button', { name: 'A', exact: true }).click()
      await page.waitForFunction(() => window.sdkLessonAudio.tones.includes(660))
    }
    if (lessons[index] === '04-speech') {
      await page.getByRole('button', { name: 'A', exact: true }).click()
      await page.waitForFunction(() => window.sdkLessonAudio.buffers.some((frames) => frames > 0))
    }
    assert.deepEqual(errors, [], messages.slice(-20).join('\n'))
    console.log(`${lessons[index]}: loaded and exercised in WASM`)
  }
  await page.screenshot({ path: '/tmp/stackchan-sdk-lessons.png', fullPage: true })
} catch (error) {
  console.error(messages.slice(-60).join('\n'))
  throw error
} finally {
  await browser?.close()
  server?.kill('SIGTERM')
}
