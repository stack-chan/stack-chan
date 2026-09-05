import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { resolveChromium, startPreview } from '../test-preview-server.mjs'

const allLessons = ['01-face', '02-tone', '03-input', '04-speech', '05-motion']
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
let page
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
    window.sdkLessonMotion = []
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
  page = await context.newPage()
  // Observe the existing factory's injected host boundary while loading the
  // unchanged generated WASM module. Retain values, never the private runtime.
  await page.route(/\/simulator\/mc\.js(?:\?|$)/, async (route) => {
    const original = new URL(route.request().url())
    if (original.searchParams.has('sdkOriginal')) return route.continue()
    original.searchParams.set('sdkOriginal', '1')
    await route.fulfill({
      contentType: 'application/javascript',
      body: `import factory from ${JSON.stringify(original.href)};
        export default function(options) {
          const driver = options.stackchanRuntime.host.Driver;
          const write = driver.applyRotation;
          driver.applyRotation = function(message) {
            window.sdkLessonMotion.push({ ...message.rotation, at: performance.now() });
            return write.call(this, message);
          };
          return factory(options);
        }`,
    })
  })
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
    if (lessons[index] === '05-motion') {
      await page.evaluate(() => { window.sdkLessonMotion = [] })
      await page.getByRole('button', { name: 'A', exact: true }).click()
      await page.waitForFunction(() => {
        const moves = window.sdkLessonMotion
        const left = moves.findIndex((move) => Math.abs(move.y - Math.PI / 12) < 0.000001)
        const right = moves.findIndex((move, index) => index > left && Math.abs(move.y + Math.PI / 12) < 0.000001)
        return left >= 0 && right > left && moves.length - 1 > right && Math.abs(moves.at(-1).y) < 0.000001
      })
      const moves = await page.evaluate(() => window.sdkLessonMotion)
      assert.ok(moves.length > 10, 'motion reaches the browser through trajectory frames')
      assert.ok(moves.at(-1).at - moves[0].at >= 1000, 'three 350ms trajectories do not finish at command acceptance')
    }
    assert.deepEqual(errors, [], messages.slice(-20).join('\n'))
    console.log(`${lessons[index]}: loaded and exercised in WASM`)
  }
  await page.screenshot({ path: '/tmp/stackchan-sdk-lessons.png', fullPage: true })
} catch (error) {
  console.error(messages.slice(-60).join('\n'))
  if (page) {
    console.error('Observed motion:', await page.evaluate(() => ({
      count: window.sdkLessonMotion.length,
      first: window.sdkLessonMotion.slice(0, 3),
      last: window.sdkLessonMotion.slice(-5),
    })).catch(() => 'page unavailable'))
    await page.screenshot({ path: '/tmp/stackchan-sdk-lessons-failed.png', fullPage: true }).catch(() => {})
  }
  throw error
} finally {
  await browser?.close()
  server?.kill('SIGTERM')
}
