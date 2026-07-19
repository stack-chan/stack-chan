import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'

const port = Number(process.env.STACKCHAN_VISUAL_TEST_PORT ?? 8098)
const baseUrl = process.env.STACKCHAN_VISUAL_TEST_URL ?? `http://127.0.0.1:${port}`
const chromiumCandidates = [
  process.env.CHROMIUM_PATH,
  '/snap/bin/chromium',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
]
const executablePath = chromiumCandidates.find((candidate) => candidate && existsSync(candidate))

if (!executablePath) throw new Error('Chromium executable not found; set CHROMIUM_PATH')

let server
if (!process.env.STACKCHAN_VISUAL_TEST_URL) {
  server = spawn(process.execPath, [resolve('static-server.mjs'), `--port=${port}`, '--host=127.0.0.1'], {
    cwd: process.cwd(),
    stdio: 'inherit',
  })
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/simulator/`)
      if (response.ok) return
    } catch {}
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
  }
  throw new Error(`visual test server did not start at ${baseUrl}`)
}

async function inspectViewport(page, name, width, height) {
  await page.setViewportSize({ width, height })
  await page.goto(`${baseUrl}/simulator/`, { waitUntil: 'networkidle' })
  await page.waitForSelector('#stackchan-viewport')
  await page.waitForFunction(
    () => {
      const screen = document.querySelector('#simulator-screen')
      const pixels = screen?.getContext('2d')?.getImageData(0, 0, screen.width, screen.height).data
      if (!pixels) return false
      const colors = new Set()
      for (let offset = 0; offset < pixels.length; offset += 128) {
        colors.add(`${pixels[offset]},${pixels[offset + 1]},${pixels[offset + 2]}`)
      }
      return colors.size > 3
    },
    { timeout: 30_000 }
  )

  const result = await page.evaluate(async () => {
    await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)))
    const stage = document.querySelector('.simulator-stage')
    const inspector = document.querySelector('.inspector')
    const viewport = document.querySelector('#stackchan-viewport')
    const screen = document.querySelector('#simulator-screen')
    const trace = document.querySelector('#trace-log')
    const stageRect = stage.getBoundingClientRect()
    const inspectorRect = inspector.getBoundingClientRect()
    const viewportRect = viewport.getBoundingClientRect()
    const screenContext = screen.getContext('2d')
    const screenPixels = screenContext.getImageData(0, 0, screen.width, screen.height).data
    const screenColors = new Set()
    for (let offset = 0; offset < screenPixels.length; offset += 128) {
      screenColors.add(`${screenPixels[offset]},${screenPixels[offset + 1]},${screenPixels[offset + 2]}`)
    }

    const webgl = viewport.getContext('webgl2') ?? viewport.getContext('webgl')
    let sceneColors = 0
    if (webgl) {
      const sampleWidth = Math.min(64, viewport.width)
      const sampleHeight = Math.min(64, viewport.height)
      const pixels = new Uint8Array(sampleWidth * sampleHeight * 4)
      webgl.readPixels(
        Math.max(0, Math.floor((viewport.width - sampleWidth) / 2)),
        Math.max(0, Math.floor((viewport.height - sampleHeight) / 2)),
        sampleWidth,
        sampleHeight,
        webgl.RGBA,
        webgl.UNSIGNED_BYTE,
        pixels
      )
      const colors = new Set()
      for (let offset = 0; offset < pixels.length; offset += 32) {
        colors.add(`${pixels[offset]},${pixels[offset + 1]},${pixels[offset + 2]},${pixels[offset + 3]}`)
      }
      sceneColors = colors.size
    }

    return {
      bodyWidth: document.body.scrollWidth,
      cursor: getComputedStyle(viewport).cursor,
      iconCount: document.querySelectorAll('svg.lucide').length,
      inspectorRect: { left: inspectorRect.left, top: inspectorRect.top, width: inspectorRect.width },
      sceneColors,
      screenColors: screenColors.size,
      stageRect: { left: stageRect.left, top: stageRect.top, right: stageRect.right, bottom: stageRect.bottom },
      traceClientHeight: trace.clientHeight,
      viewportRect: { width: viewportRect.width, height: viewportRect.height },
    }
  })

  assert.equal(result.bodyWidth <= width, true, `${name}: page must not overflow horizontally`)
  assert.notEqual(result.cursor, 'none', `${name}: 3D viewport must keep a visible cursor`)
  assert.equal(result.iconCount >= 5, true, `${name}: Lucide controls must render`)
  assert.equal(
    result.viewportRect.width > 0 && result.viewportRect.height >= 420,
    true,
    `${name}: 3D viewport must be visible`
  )
  assert.equal(result.screenColors > 3, true, `${name}: Piu screen canvas must contain rendered pixels`)
  assert.equal(result.sceneColors > 1, true, `${name}: WebGL canvas must contain a nonblank scene`)
  if (width > 760) {
    const stableStageHeight = Math.round(result.stageRect.bottom - result.stageRect.top)
    assert.equal(
      result.stageRect.right <= result.inspectorRect.left,
      true,
      `${name}: inspector must not overlap the scene`
    )
    const overflowLayout = await page.evaluate(() => {
      const stage = document.querySelector('.simulator-stage')
      const trace = document.querySelector('#trace-log')
      trace.textContent = Array.from({ length: 200 }, (_, index) => `log line ${index}`).join('\n')
      return {
        stageHeight: Math.round(stage.getBoundingClientRect().height),
        traceClientHeight: trace.clientHeight,
        traceScrollHeight: trace.scrollHeight,
      }
    })
    assert.equal(
      overflowLayout.stageHeight,
      stableStageHeight,
      `${name}: overflowing logs must not resize the 3D scene`
    )
    assert.equal(
      overflowLayout.traceScrollHeight > overflowLayout.traceClientHeight,
      true,
      `${name}: overflowing logs must scroll inside the log view`
    )

    const observedResize = await page.evaluate(async () => {
      const layout = document.querySelector('.simulator-layout')
      const stage = document.querySelector('.simulator-stage')
      const viewport = document.querySelector('#stackchan-viewport')
      layout.style.gridTemplateColumns = 'minmax(0, 1fr) 400px'
      await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)))
      const rect = stage.getBoundingClientRect()
      const ratio = Math.min(devicePixelRatio, 2)
      const result = {
        expectedWidth: Math.round(rect.width * ratio),
        renderWidth: viewport.width,
      }
      layout.style.gridTemplateColumns = ''
      return result
    })
    assert.equal(
      Math.abs(observedResize.renderWidth - observedResize.expectedWidth) <= 1,
      true,
      `${name}: parent resize must update the WebGL drawing buffer`
    )
  } else {
    assert.equal(
      result.stageRect.bottom <= result.inspectorRect.top,
      true,
      `${name}: mobile inspector must follow the scene`
    )
  }

  await page.screenshot({ path: `/tmp/stackchan-${name}.png`, fullPage: true })

  if (name === 'desktop') {
    const screenSignature = () =>
      page.evaluate(() => {
        const screen = document.querySelector('#simulator-screen')
        const pixels = screen.getContext('2d').getImageData(0, 0, screen.width, screen.height).data
        let hash = 2166136261
        for (let offset = 0; offset < pixels.length; offset += 64) {
          hash ^= pixels[offset]
          hash = Math.imul(hash, 16777619)
          hash ^= pixels[offset + 1]
          hash = Math.imul(hash, 16777619)
          hash ^= pixels[offset + 2]
          hash = Math.imul(hash, 16777619)
        }
        return hash >>> 0
      })
    const touchPiu = async (x, y) => {
      await page.evaluate(
        ([touchX, touchY]) => {
          const when = performance.now()
          globalThis.gxView.touchScreenPoint(0, 0, touchX, touchY, when)
          globalThis.gxView.touchScreenPoint(2, 0, touchX, touchY, when + 20)
        },
        [x, y]
      )
      await page.waitForTimeout(300)
    }
    const savePiuScreen = async (screenName) => {
      const dataUrl = await page.evaluate(() => document.querySelector('#simulator-screen').toDataURL('image/png'))
      writeFileSync(`/tmp/stackchan-screen-${screenName}.png`, Buffer.from(dataUrl.split(',')[1], 'base64'))
    }
    const waitForScreenChange = async (previousSignature, timeoutMs) => {
      const deadline = Date.now() + timeoutMs
      let signature = previousSignature
      while (signature === previousSignature && Date.now() < deadline) {
        await page.waitForTimeout(200)
        signature = await screenSignature()
      }
      return signature
    }

    const splashSignature = await screenSignature()
    await touchPiu(160, 206)
    const settingsSignature = await waitForScreenChange(splashSignature, 5_000)
    assert.notEqual(settingsSignature, splashSignature, 'settings action must leave the splash screen')
    await page.screenshot({ path: '/tmp/stackchan-settings.png', fullPage: true })
    await savePiuScreen('settings')
    await touchPiu(160, 66)
    const wifiSettingsSignature = await waitForScreenChange(settingsSignature, 5_000)
    assert.notEqual(wifiSettingsSignature, settingsSignature, 'Wi-Fi menu item must open network settings')
    await savePiuScreen('wifi-settings')
    await touchPiu(82, 98)
    const networkListSignature = await waitForScreenChange(wifiSettingsSignature, 10_000)
    assert.notEqual(networkListSignature, wifiSettingsSignature, 'network settings must open the scanned network list')
    await savePiuScreen('network-list')
    await touchPiu(160, 146)
    const passwordSignature = await waitForScreenChange(networkListSignature, 5_000)
    assert.notEqual(passwordSignature, networkListSignature, 'network selection must open the password screen')
    const readPasswordLayout = () =>
      page.evaluate(() => {
        const screen = document.querySelector('#simulator-screen')
        const pixels = screen.getContext('2d')
        const brightnessAt = (x, y) => {
          const [r, g, b] = pixels.getImageData(x, y, 1, 1).data
          return r + g + b
        }
        return {
          field: brightnessAt(20, 60),
          gap: brightnessAt(20, 74),
          bottomKey: brightnessAt(10, 220),
        }
      })
    const passwordDeadline = Date.now() + 5_000
    let passwordLayout = await readPasswordLayout()
    while (
      !(passwordLayout.field > 600 && passwordLayout.gap < 100 && passwordLayout.bottomKey > 300) &&
      Date.now() < passwordDeadline
    ) {
      await page.waitForTimeout(100)
      passwordLayout = await readPasswordLayout()
    }
    await page.screenshot({ path: '/tmp/stackchan-password.png', fullPage: true })
    await savePiuScreen('password')
    assert.equal(
      passwordLayout.field > 600,
      true,
      `password field must remain visible above the keyboard: ${JSON.stringify(passwordLayout)}`
    )
    assert.equal(
      passwordLayout.gap < 100,
      true,
      `password field and keyboard must not overlap: ${JSON.stringify(passwordLayout)}`
    )
    assert.equal(
      passwordLayout.bottomKey > 300,
      true,
      `keyboard bottom row must remain visible: ${JSON.stringify(passwordLayout)}`
    )
    const passwordReadySignature = await screenSignature()
    await touchPiu(22, 20)
    const wifiBackSignature = await waitForScreenChange(passwordReadySignature, 5_000)
    assert.notEqual(wifiBackSignature, passwordReadySignature, 'password back action must open Wi-Fi settings')
    await touchPiu(22, 20)
    const settingsMenuSignature = await waitForScreenChange(wifiBackSignature, 5_000)
    assert.notEqual(settingsMenuSignature, wifiBackSignature, 'Wi-Fi back action must open the settings menu')
    await touchPiu(22, 20)
    const returnedSplashSignature = await waitForScreenChange(settingsMenuSignature, 5_000)
    assert.notEqual(
      returnedSplashSignature,
      settingsMenuSignature,
      'settings back action must return to the splash screen'
    )
    const mainSignature = await waitForScreenChange(returnedSplashSignature, 20_000)
    assert.notEqual(mainSignature, returnedSplashSignature, 'auto boot must open the main face')
    const menuHiddenSignature = await waitForScreenChange(mainSignature, 6000)
    assert.notEqual(menuHiddenSignature, mainSignature, 'main menu must hide after auto boot')
    await page.screenshot({ path: '/tmp/stackchan-main.png', fullPage: true })
    await savePiuScreen('main-menu-hidden')
    await touchPiu(160, 120)
    const drawerSignature = await screenSignature()
    assert.notEqual(drawerSignature, menuHiddenSignature, 'face touch must open the drawer after the menu button hides')
    await page.screenshot({ path: '/tmp/stackchan-drawer.png', fullPage: true })
    await savePiuScreen('drawer')

    await page.evaluate(() => {
      const originalPlay = globalThis.Host.AudioOut.play
      globalThis.__stackchanSpeechProbe = {
        byteLength: 0,
        completed: false,
        dataBytes: 0,
        error: '',
        format: '',
        played: false,
        sampleRate: 0,
      }
      globalThis.Host.AudioOut.play = async (buffer) => {
        const probe = globalThis.__stackchanSpeechProbe
        const view = new DataView(buffer)
        const bytes = new Uint8Array(buffer)
        probe.byteLength = buffer.byteLength
        probe.dataBytes = view.getUint32(40, true)
        probe.format = String.fromCharCode(...bytes.subarray(0, 4), ...bytes.subarray(8, 12))
        probe.sampleRate = view.getUint32(24, true)
        try {
          probe.played = await originalPlay(buffer)
          return probe.played
        } catch (error) {
          probe.error = String(error)
          throw error
        } finally {
          probe.completed = true
        }
      }
    })
    await touchPiu(220, 170)
    await page.waitForFunction(() => globalThis.__stackchanSpeechProbe?.completed, undefined, { timeout: 30_000 })
    const speech = await page.evaluate(() => globalThis.__stackchanSpeechProbe)
    assert.equal(speech.error, '', `stackchan-voice browser playback must not fail: ${speech.error}`)
    assert.equal(speech.played, true, 'stackchan-voice WAV must decode and play through the browser Audio bridge')
    assert.equal(speech.format, 'RIFFWAVE', 'stackchan-voice must render a WAV container')
    assert.equal(speech.sampleRate, 24_000, 'stackchan-voice WAV must use its 24 kHz output rate')
    assert.equal(speech.dataBytes > 0, true, 'stackchan-voice must synthesize non-empty PCM')
    assert.equal(
      speech.byteLength,
      speech.dataBytes + 44,
      'stackchan-voice WAV header must describe the synthesized PCM'
    )

    await touchPiu(160, 120)
    await touchPiu(220, 26)
    const faceMenuSignature = await screenSignature()
    assert.notEqual(faceMenuSignature, drawerSignature, 'face mode must open an option menu')
    await page.screenshot({ path: '/tmp/stackchan-face-menu.png', fullPage: true })
    await savePiuScreen('face-menu')
    await touchPiu(220, 110)
    await touchPiu(60, 120)
    const dogFaceSignature = await screenSignature()
    assert.notEqual(dogFaceSignature, menuHiddenSignature, 'selecting a face option must update the face')
    const dogNoseVisible = await page.evaluate(() => {
      const screen = document.querySelector('#simulator-screen')
      const [r, g, b] = screen.getContext('2d').getImageData(160, 124, 1, 1).data
      return r + g + b > 300
    })
    assert.equal(dogNoseVisible, true, 'dog face selection must render its nose at the face center')
    await page.screenshot({ path: '/tmp/stackchan-dog-face.png', fullPage: true })
    await savePiuScreen('dog-face')
    await touchPiu(298, 22)
    await touchPiu(220, 170)
    await page.waitForTimeout(1500)
    const cameraSignature = await screenSignature()
    assert.notEqual(cameraSignature, dogFaceSignature, 'camera action must open a preview')
    await page.screenshot({ path: '/tmp/stackchan-camera.png', fullPage: true })
    await savePiuScreen('camera')
    await touchPiu(298, 64)
    const cameraClosedSignature = await screenSignature()
    assert.notEqual(cameraClosedSignature, cameraSignature, 'camera close action must leave the preview')
    await page.screenshot({ path: '/tmp/stackchan-camera-closed.png', fullPage: true })
    await savePiuScreen('camera-closed')

    const beforeSampleSignature = await screenSignature()
    await page.locator('#mod-archive-input').setInputFiles({
      name: 'stackchan-sample-mod.xsa',
      mimeType: 'application/octet-stream',
      buffer: readFileSync(resolve('simulator/samples/stackchan-sample-mod.xsa')),
    })
    await page.waitForFunction(
      () => document.querySelector('#trace-log')?.textContent.includes('[sample-mod] onContextCreated'),
      undefined,
      { timeout: 30_000 }
    )
    await page.waitForFunction(
      () => document.querySelector('#mod-install-status')?.textContent.includes('適用済み'),
      undefined,
      { timeout: 30_000 }
    )
    const sampleModSignature = await waitForScreenChange(beforeSampleSignature, 10_000)
    assert.notEqual(sampleModSignature, beforeSampleSignature, 'the checked-in sample MOD must visibly update the face')
    const sampleModLog = await page.locator('#trace-log').textContent()
    assert.doesNotMatch(
      sampleModLog,
      /display list overflowed|# Exception|XS abort/,
      'the checked-in sample MOD must render without a runtime exception'
    )
    const sampleModHasVisiblePixels = await page.evaluate(() => {
      const screen = document.querySelector('#simulator-screen')
      const pixels = screen.getContext('2d').getImageData(0, 0, screen.width, screen.height).data
      for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index] || pixels[index + 1] || pixels[index + 2]) return true
      }
      return false
    })
    assert.equal(sampleModHasVisiblePixels, true, 'the checked-in sample MOD must not leave a black screen')
    await page.screenshot({ path: '/tmp/stackchan-sample-mod.png', fullPage: true })
    await savePiuScreen('sample-mod')
    await page.locator('#mod-clear-button').click()
  }
}

let browser
try {
  await waitForServer()
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] })
  const page = await browser.newPage()
  await inspectViewport(page, 'desktop', 1280, 800)
  await inspectViewport(page, 'mobile', 390, 844)
  console.log(
    'visual checks passed: /tmp/stackchan-{desktop,mobile,settings,password,main,drawer,face-menu,dog-face,camera,camera-closed,sample-mod}.png and /tmp/stackchan-screen-{settings,wifi-settings,network-list,password,main-menu-hidden,drawer,face-menu,dog-face,camera,camera-closed,sample-mod}.png'
  )
} finally {
  await browser?.close()
  server?.kill('SIGTERM')
}
