import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { resolveChromium, startPreview } from '../test-preview-server.mjs'

const allLessons = ['01-face', '02-tone', '03-input', '04-speech', '05-motion', '06-camera']
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
    args: [
      '--no-sandbox',
      '--use-gl=swiftshader',
      '--autoplay-policy=no-user-gesture-required',
      '--use-fake-device-for-media-stream',
    ],
  })
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['camera'] })
  await context.addInitScript(() => {
    localStorage.setItem('stackchan.locale', 'ja')
    window.sdkLessonAudio = { tones: [], buffers: [] }
    window.sdkLessonMotion = []
    window.sdkLessonCamera = []
    window.sdkLessonScreenColors = 0
    window.sdkCameraTracks = 0
    const media = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = async function (options) {
      const stream = await media(options)
      for (const track of stream.getTracks()) {
        window.sdkCameraTracks++
        const stop = track.stop.bind(track)
        let stopped = false
        track.stop = () => {
          stop()
          if (!stopped) {
            stopped = true
            window.sdkCameraTracks--
          }
        }
      }
      return stream
    }
    const putImage = CanvasRenderingContext2D.prototype.putImageData
    CanvasRenderingContext2D.prototype.putImageData = function (image, ...args) {
      if (image.width === 320 && image.height === 240) {
        let colored = 0
        for (let index = 0; index < image.data.length; index += 4) {
          const r = image.data[index],
            g = image.data[index + 1],
            b = image.data[index + 2]
          if (Math.max(r, g, b) - Math.min(r, g, b) > 50) colored++
        }
        window.sdkLessonScreenColors = colored
      }
      return putImage.call(this, image, ...args)
    }
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
          const camera = options.stackchanRuntime.host.Camera;
          const startCamera = camera.start, stopCamera = camera.stop, captureCamera = camera.capture;
          camera.start = async function(options) {
            await startCamera.call(this, options);
            window.sdkLessonCamera.push({ action: 'start' });
          };
          camera.stop = function() {
            const result = stopCamera.call(this);
            window.sdkLessonCamera.push({ action: 'stop' });
            return result;
          };
          camera.capture = function(options) {
            const frame = captureCamera.call(this, options);
            if (frame) window.sdkLessonCamera.push({ action: 'capture', width: frame.width, height: frame.height, bytes: frame.buffer.byteLength, colors: new Set(new Uint16Array(frame.buffer)).size, source: frame.source });
            return frame;
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
      await page.evaluate(() => {
        window.sdkLessonMotion = []
      })
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
    if (lessons[index] === '06-camera') {
      await page.evaluate(() => {
        window.sdkLessonCamera = []
      })
      await page.getByRole('button', { name: 'A', exact: true }).click()
      await page.waitForFunction(
        () =>
          window.sdkLessonCamera.some((event) => event.action === 'capture') &&
          window.sdkLessonCamera.at(-1)?.action === 'stop'
      )
      const events = await page.evaluate(() => window.sdkLessonCamera)
      assert.deepEqual(
        events.map((event) => event.action),
        ['start', 'capture', 'stop']
      )
      const captured = events[1]
      assert.equal(captured.source, 'native')
      assert.equal(captured.bytes, captured.width * captured.height * 2)
      assert.ok(captured.colors > 4, 'Chromium video reaches firmware as a real, varied RGB565 frame')
      await page.waitForFunction(() => window.sdkLessonScreenColors > 1000, undefined, { timeout: 10_000 })
    }
    assert.deepEqual(errors, [], messages.slice(-20).join('\n'))
    console.log(`${lessons[index]}: loaded and exercised in WASM`)
  }
  await page.screenshot({ path: '/tmp/stackchan-sdk-lessons.png', fullPage: true })
  if (lessons.includes('06-camera')) {
    assert.equal(await page.evaluate(() => window.sdkCameraTracks), 0, 'one-shot capture releases all browser tracks')
    await page.getByRole('button', { name: 'カメラを接続', exact: true }).click()
    await page.waitForFunction(() => window.sdkCameraTracks > 0)
    await Promise.all([ready(), page.getByRole('button', { name: '再起動', exact: true }).click()])
    assert.equal(
      await page.evaluate(() => window.sdkCameraTracks),
      0,
      'restarting firmware closes the old browser camera'
    )
    assert.deepEqual(errors, [], messages.slice(-20).join('\n'))
    console.log('camera: pixels displayed and tracks released on capture / firmware restart')
  }
} catch (error) {
  console.error(messages.slice(-60).join('\n'))
  if (page) {
    console.error(
      'Observed motion:',
      await page
        .evaluate(() => ({
          count: window.sdkLessonMotion.length,
          first: window.sdkLessonMotion.slice(0, 3),
          last: window.sdkLessonMotion.slice(-5),
        }))
        .catch(() => 'page unavailable')
    )
    await page.screenshot({ path: '/tmp/stackchan-sdk-lessons-failed.png', fullPage: true }).catch(() => {})
  }
  throw error
} finally {
  await browser?.close()
  server?.kill('SIGTERM')
}
