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
  ['mediapipe', '/mediapipe/'],
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
  assert.equal(
    await page.getByRole('note').getByText('インストール済みのMOD', { exact: false }).count(),
    1,
    'the React flash tool must explain that installing erases device settings and MODs'
  )

  await page.goto(`${baseUrl}/preference/`, { waitUntil: 'networkidle' })
  assert.equal(
    await page.getByRole('note').getByText('本体の設定画面', { exact: false }).count(),
    1,
    'the React preference tool must explain the device-side pairing prerequisite'
  )

  await page.goto(`${baseUrl}/mediapipe/`, { waitUntil: 'networkidle' })
  const installUrl = new URL(await page.locator('#install-mod-link').getAttribute('href'), page.url())
  assert.equal(installUrl.pathname, new URL('../mod-gallery/', page.url()).pathname)
  assert.equal(installUrl.searchParams.get('mod'), 'tech.stackchan.samples.mediapipe-ble')
  assert.equal(await page.locator('#camera-button').isVisible(), true)
  assert.equal(await page.locator('#ble-button').isVisible(), true)

  await page.goto(`${baseUrl}/mod-gallery/?mod=tech.stackchan.samples.mediapipe-ble`, {
    waitUntil: 'networkidle',
  })
  const selectedMediaPipeMod = page.locator(
    '[data-mod-id="tech.stackchan.samples.mediapipe-ble"][data-selected="true"]'
  )
  await selectedMediaPipeMod.waitFor()
  assert.equal(
    await selectedMediaPipeMod.getByRole('button', { name: 'シミュレーターで試す' }).count(),
    0,
    'the CoreS3-only MediaPipe MOD must not offer simulator installation'
  )
  assert.equal(await selectedMediaPipeMod.getByRole('button', { name: '実機へ書き込む' }).count(), 1)

  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  assert.equal(await page.locator('html.light').count(), 1, 'saved light theme must be active')
  const productImage = page.getByRole('img', { name: 'ｽﾀｯｸﾁｬﾝ' })
  assert.equal(await productImage.count(), 1)
  assert.equal(
    await productImage.evaluate((image) => image.complete && image.naturalWidth > 0),
    true,
    'the Vite home entry must render the shared Stack-chan image asset'
  )
  await page.getByRole('button', { name: 'ツールメニューを開く' }).click()
  const toolMenu = page.getByRole('dialog', { name: 'Webツール' })
  await toolMenu.waitFor()
  const closeToolMenu = toolMenu.getByRole('button', { name: '閉じる' })
  assert.equal(await closeToolMenu.count(), 1, 'the shared menu close button must use the active locale')
  assert.equal(await toolMenu.getByRole('link', { name: /MediaPipe BLE追従/ }).count(), 1)
  await page.screenshot({ path: '/tmp/stackchan-navigation-open.png', fullPage: true })
  await closeToolMenu.click()
  await toolMenu.waitFor({ state: 'hidden' })

  await page.setViewportSize({ width: 1728, height: 900 })
  await page.goto(`${baseUrl}/editor/`, { waitUntil: 'networkidle' })
  pageErrors.length = 0
  await page.getByRole('button', { name: 'ツールメニューを開く' }).click()
  const editorToolMenu = page.getByRole('dialog', { name: 'Webツール' })
  await editorToolMenu.waitFor()
  const editorLayering = await page.evaluate(() => {
    const sheet = document.querySelector('[data-slot="sheet-content"]')
    const workspace = document.querySelector('[aria-label="Blocklyワークスペース"]')
    const dropdown = document.querySelector('.blocklyDropDownDiv')
    if (!sheet || !workspace) return null
    const sheetRect = sheet.getBoundingClientRect()
    const workspaceRect = workspace.getBoundingClientRect()
    const x = sheetRect.left + Math.min(80, sheetRect.width / 2)
    const y = Math.min(sheetRect.bottom - 20, Math.max(sheetRect.top + 80, workspaceRect.top + 20))
    const topElement = document.elementFromPoint(x, y)
    return {
      sheetOwnsTopElement: Boolean(topElement && sheet.contains(topElement)),
      workspaceIsolation: getComputedStyle(workspace).isolation,
      workspaceZIndex: getComputedStyle(workspace).zIndex,
      dropdownZIndex: dropdown ? Number(getComputedStyle(dropdown).zIndex) : -1,
    }
  })
  assert.deepEqual(
    editorLayering,
    {
      sheetOwnsTopElement: true,
      workspaceIsolation: 'isolate',
      workspaceZIndex: '0',
      dropdownZIndex: 30,
    },
    'Blockly layers must stay below the AppBar and tool sidebar'
  )
  await editorToolMenu.getByRole('button', { name: '閉じる' }).click()
  await editorToolMenu.waitFor({ state: 'hidden' })

  await page.getByRole('button', { name: 'プロジェクト操作' }).click()
  await page.getByRole('menuitem', { name: '新しいプロジェクト' }).waitFor()
  assert.deepEqual(
    pageErrors.map((error) => error.message),
    [],
    'opening the project menu must not raise uncaught errors'
  )
  await page.keyboard.press('Escape')
  await page.getByRole('tab', { name: 'ログ', exact: true }).click()
  const editorLayout = await page.evaluate(() => {
    const workspace = document.querySelector('[aria-label="Blocklyワークスペース"]')
    const pageContainer = workspace?.parentElement?.parentElement
    const copyButton = document.querySelector('button[aria-label="ログをコピー"]')
    const clearButton = document.querySelector('button[aria-label="ログを消去"]')
    return {
      containerWidth: pageContainer?.getBoundingClientRect().width ?? 0,
      copyY: copyButton?.getBoundingClientRect().y ?? -1,
      clearY: clearButton?.getBoundingClientRect().y ?? -2,
      viewportWidth: document.documentElement.clientWidth,
      workspaceWidth: workspace?.getBoundingClientRect().width ?? 0,
    }
  })
  assert.ok(
    editorLayout.containerWidth >= editorLayout.viewportWidth * 0.95,
    'the project editor must use the available wide-screen width'
  )
  assert.ok(editorLayout.workspaceWidth >= 1100, 'the Blockly workspace must remain wide on a wide desktop')
  assert.equal(editorLayout.copyY, editorLayout.clearY, 'log actions must stay on the same row')

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
  await page.getByRole('button', { name: 'シミュレーターで実行' }).click()
  const projectSimulator = page.getByRole('dialog', { name: 'シミュレーター' })
  await projectSimulator.waitFor()
  assert.equal(
    await projectSimulator.locator('iframe').count(),
    0,
    'the project simulator must not embed a navigable page'
  )
  const simulatorLayout = await projectSimulator.evaluate((dialog) => {
    const viewport = dialog.querySelector('[aria-label="ｽﾀｯｸﾁｬﾝ3Dシミュレーター"]')
    const dialogRect = dialog.getBoundingClientRect()
    const viewportRect = viewport?.getBoundingClientRect()
    return {
      dialogWidth: dialogRect.width,
      dialogHeight: dialogRect.height,
      viewportWidth: viewportRect?.width ?? 0,
      viewportHeight: viewportRect?.height ?? 0,
      viewportWidthAvailable: document.documentElement.clientWidth,
      viewportHeightAvailable: document.documentElement.clientHeight,
    }
  })
  assert.ok(
    simulatorLayout.dialogWidth >= simulatorLayout.viewportWidthAvailable * 0.95,
    'the project simulator dialog must use nearly the full viewport width'
  )
  assert.ok(
    simulatorLayout.dialogHeight >= simulatorLayout.viewportHeightAvailable * 0.95,
    'the project simulator dialog must use nearly the full viewport height'
  )
  assert.ok(simulatorLayout.viewportWidth >= 800, 'the embedded simulator viewport must remain usable on desktop')
  assert.ok(simulatorLayout.viewportHeight >= 400, 'the embedded simulator viewport must remain tall enough to render')
  await projectSimulator.getByRole('button', { name: '閉じる' }).click()
  await projectSimulator.waitFor({ state: 'hidden' })

  await page.evaluate(() => localStorage.setItem('stackchan.theme', 'dark'))
  await page.reload({ waitUntil: 'networkidle' })
  assert.equal(await page.locator('html.dark').count(), 1, 'saved dark theme must apply before app interaction')
  await page.screenshot({ path: '/tmp/stackchan-editor-dark.png', fullPage: false })
} finally {
  await browser?.close()
  server?.kill('SIGTERM')
}
