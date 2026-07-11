import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
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
  server = spawn(
    process.execPath,
    [
      resolve('node_modules/live-server/live-server.js'),
      `--port=${port}`,
      '--host=127.0.0.1',
      '--no-browser',
      '--quiet',
    ],
    { cwd: process.cwd(), stdio: 'inherit' }
  )
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
  await page.waitForTimeout(1200)

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
  assert.equal(result.sceneColors > 3, true, `${name}: WebGL canvas must contain a nonblank scene`)
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

    const splashSignature = await screenSignature()
    await touchPiu(160, 206)
    const settingsSignature = await screenSignature()
    assert.notEqual(settingsSignature, splashSignature, 'settings action must leave the splash screen')
    await page.screenshot({ path: '/tmp/stackchan-settings.png', fullPage: true })
    await touchPiu(82, 98)
    await page.waitForTimeout(600)
    await touchPiu(160, 146)
    await page.waitForTimeout(700)
    const passwordSignature = await screenSignature()
    assert.notEqual(passwordSignature, settingsSignature, 'network selection must open the password screen')
    await page.screenshot({ path: '/tmp/stackchan-password.png', fullPage: true })
    await savePiuScreen('password')
    await touchPiu(22, 20)
    await touchPiu(22, 20)
    await page.waitForTimeout(8500)
    const mainSignature = await screenSignature()
    assert.notEqual(mainSignature, splashSignature, 'auto boot must open the main face')
    await page.waitForTimeout(4500)
    await page.screenshot({ path: '/tmp/stackchan-main.png', fullPage: true })
    await savePiuScreen('main-menu-hidden')
    await touchPiu(160, 120)
    const drawerSignature = await screenSignature()
    assert.notEqual(drawerSignature, mainSignature, 'face touch must open the drawer after the menu button hides')
    await page.screenshot({ path: '/tmp/stackchan-drawer.png', fullPage: true })
    await touchPiu(220, 26)
    const faceMenuSignature = await screenSignature()
    assert.notEqual(faceMenuSignature, drawerSignature, 'face mode must open an option menu')
    await page.screenshot({ path: '/tmp/stackchan-face-menu.png', fullPage: true })
    await touchPiu(220, 110)
    await touchPiu(60, 120)
    const dogFaceSignature = await screenSignature()
    assert.notEqual(dogFaceSignature, mainSignature, 'selecting a face option must update the face')
    const dogNoseVisible = await page.evaluate(() => {
      const screen = document.querySelector('#simulator-screen')
      const [r, g, b] = screen.getContext('2d').getImageData(160, 124, 1, 1).data
      return r + g + b > 300
    })
    assert.equal(dogNoseVisible, true, 'dog face selection must render its nose at the face center')
    await page.screenshot({ path: '/tmp/stackchan-dog-face.png', fullPage: true })
    await savePiuScreen('menu-revealed')
    await touchPiu(298, 22)
    await touchPiu(220, 170)
    await page.waitForTimeout(1500)
    const cameraSignature = await screenSignature()
    assert.notEqual(cameraSignature, dogFaceSignature, 'camera action must open a preview')
    await page.screenshot({ path: '/tmp/stackchan-camera.png', fullPage: true })
    await touchPiu(298, 64)
    const cameraClosedSignature = await screenSignature()
    assert.notEqual(cameraClosedSignature, cameraSignature, 'camera close action must leave the preview')
    await page.screenshot({ path: '/tmp/stackchan-camera-closed.png', fullPage: true })
  }
}

await waitForServer()
const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] })
try {
  const page = await browser.newPage()
  await inspectViewport(page, 'desktop', 1280, 800)
  await inspectViewport(page, 'mobile', 390, 844)
  console.log(
    'visual checks passed: /tmp/stackchan-{desktop,mobile,settings,password,main,drawer,face-menu,dog-face,camera,camera-closed}.png and /tmp/stackchan-screen-{password,main-menu-hidden,menu-revealed}.png'
  )
} finally {
  await browser.close()
  server?.kill('SIGTERM')
}
