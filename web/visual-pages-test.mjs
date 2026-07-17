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
  '/usr/bin/google-chrome',
].find((candidate) => candidate && existsSync(candidate))
if (!executablePath) throw new Error('Chromium executable not found; set CHROMIUM_PATH')

async function captureBrowserDownload(page, trigger) {
  await page.evaluate(() => {
    if (!globalThis.__stackchanOriginalCreateObjectURL) {
      globalThis.__stackchanOriginalCreateObjectURL = URL.createObjectURL.bind(URL)
      URL.createObjectURL = (blob) => {
        globalThis.__stackchanDownloadBlob = blob
        return globalThis.__stackchanOriginalCreateObjectURL(blob)
      }
    }
    globalThis.__stackchanDownloadBlob = null
  })
  const downloadPromise = page.waitForEvent('download')
  await trigger()
  const download = await downloadPromise
  const captured = await page.evaluate(async () => {
    const blob = globalThis.__stackchanDownloadBlob
    if (!blob) return null
    return {
      type: blob.type,
      bytes: [...new Uint8Array(await blob.arrayBuffer())],
    }
  })
  assert.ok(captured, `download Blob must be captured: ${download.suggestedFilename()}`)
  await download.cancel().catch(() => {})
  return { download, bytes: Buffer.from(captured.bytes), type: captured.type }
}

async function openProjectMenu(page) {
  const menu = page.locator('#project-menu')
  if (await menu.isHidden()) {
    await page.locator('#project-menu-button').click()
    await menu.waitFor({ state: 'visible' })
  }
}

async function clickProjectAction(page, actionId) {
  await openProjectMenu(page)
  await page.locator(`#${actionId}`).click()
}

let server
if (!process.env.STACKCHAN_PAGES_TEST_URL) {
  server = spawn(process.execPath, [resolve('static-server.mjs'), `--port=${port}`, '--host=127.0.0.1'], {
    cwd: process.cwd(),
    stdio: 'inherit',
  })
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(baseUrl)).ok) return
    } catch {}
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
  }
  throw new Error(`visual test server did not start at ${baseUrl}`)
}

const pages = [
  ['home', '/'],
  ['flash', '/flash/'],
  ['preference', '/preference/'],
  ['editor', '/editor/'],
  ['tutorial', '/editor/tutorial.html'],
  ['face-editor', '/face-editor/'],
]
const viewports = [
  ['desktop', 1280, 800],
  ['tablet', 600, 800],
  ['mobile', 390, 844],
]

let browser
try {
  await waitForServer()
  browser = await chromium.launch({
    executablePath,
    headless: true,
    downloadsPath: '/tmp/stackchan-playwright-downloads',
    args: ['--no-sandbox'],
  })
  const page = await browser.newPage({ acceptDownloads: true })
  await page.addInitScript(() => {
    if (!('serial' in navigator)) {
      Object.defineProperty(navigator, 'serial', {
        configurable: true,
        value: {
          requestPort: () => Promise.reject(new Error('WebSerial is not used by visual tests')),
        },
      })
    }
  })
  for (const [viewportName, width, height] of viewports) {
    await page.setViewportSize({ width, height })
    for (const [pageName, pathname] of pages) {
      if (viewportName === 'tablet' && pageName !== 'editor') continue
      if (pageName === 'editor' && viewportName === 'desktop') {
        await page.evaluate(
          (legacyWorkspace) =>
            new Promise((resolve) => {
              localStorage.removeItem('stackchan-visual-project-v1')
              localStorage.removeItem('stackchan-visual-project-library-v1')
              localStorage.setItem('stackchan-blockly-workspace', JSON.stringify(legacyWorkspace))
              const request = indexedDB.deleteDatabase('stackchan-visual-projects')
              request.onsuccess = () => resolve()
              request.onerror = () => resolve()
              request.onblocked = () => resolve()
            }),
          {
            blocks: {
              languageVersion: 0,
              blocks: [
                {
                  type: 'stackchan_on_start',
                  inputs: {
                    DO: {
                      block: {
                        type: 'stackchan_show_balloon',
                        inputs: {
                          TEXT: {
                            shadow: {
                              type: 'text',
                              fields: { TEXT: '旧形式から移行' },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              ],
            },
          }
        )
      }
      await page.goto(`${baseUrl}${pathname}`, {
        waitUntil: 'domcontentloaded',
      })
      await page.waitForSelector('.topbar')
      await page.waitForSelector('.tool-menu-button')
      const layout = await page.evaluate(() => {
        const topbar = document.querySelector('.topbar').getBoundingClientRect()
        const accessibleName = (element) => {
          const direct = element.getAttribute('aria-label')?.trim()
          if (direct) return direct
          const referenced = (element.getAttribute('aria-labelledby') ?? '')
            .split(/\s+/)
            .filter(Boolean)
            .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
            .filter(Boolean)
            .join(' ')
          if (referenced) return referenced
          const labels = [...(element.labels ?? [])]
            .map((label) => label.textContent?.trim() ?? '')
            .filter(Boolean)
            .join(' ')
          if (labels) return labels
          if (element.matches('button, a[href], [role="tab"]')) {
            return element.textContent?.trim() || element.getAttribute('title')?.trim() || ''
          }
          if (element instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(element.type)) {
            return element.value.trim() || element.getAttribute('title')?.trim() || ''
          }
          return element.getAttribute('title')?.trim() || ''
        }
        // Long user-entered text in inputs scrolls horizontally by design; verify
        // fixed action labels and select values instead.
        const interactive = [...document.querySelectorAll('button, a, select')]
        const accessibilityTargets = [
          ...document.querySelectorAll('button, a[href], input:not([type="hidden"]), select, textarea, [role="tab"]'),
        ]
        return {
          bodyWidth: document.body.scrollWidth,
          topbar: {
            left: topbar.left,
            right: topbar.right,
            height: topbar.height,
          },
          clippedText: interactive
            .filter((element) => element.scrollWidth > element.clientWidth + 1)
            .map(
              (element) => element.id || element.getAttribute('aria-label') || element.textContent.trim().slice(0, 40)
            ),
          visibleHiddenElements: [...document.querySelectorAll('[hidden]')].filter(
            (element) => getComputedStyle(element).display !== 'none'
          ).length,
          projectMenuButtonVisible: document.querySelector('#project-menu-button')?.getClientRects().length > 0,
          toolMenuButtonVisible: document.querySelector('.tool-menu-button')?.getClientRects().length > 0,
          legacyToolNavCount: document.querySelectorAll('.tool-nav').length,
          unnamedInteractive: accessibilityTargets
            .filter((element) => element.getClientRects().length > 0 && !accessibleName(element))
            .map((element) => element.id || element.outerHTML.slice(0, 120)),
        }
      })
      assert.equal(layout.bodyWidth <= width, true, `${pageName}/${viewportName}: page must not overflow horizontally`)
      assert.equal(
        layout.topbar.left >= 0 && layout.topbar.right <= width,
        true,
        `${pageName}/${viewportName}: header must fit viewport`
      )
      assert.equal(
        layout.topbar.height >= 48 && layout.topbar.height <= 52,
        true,
        `${pageName}/${viewportName}: header height must remain stable`
      )
      assert.deepEqual(layout.clippedText, [], `${pageName}/${viewportName}: interactive text must not be clipped`)
      assert.equal(layout.visibleHiddenElements, 0, `${pageName}/${viewportName}: hidden controls must not be rendered`)
      assert.equal(layout.toolMenuButtonVisible, true, `${pageName}/${viewportName}: left tool menu must be visible`)
      assert.equal(layout.legacyToolNavCount, 0, `${pageName}/${viewportName}: right tool navigation must be removed`)
      assert.deepEqual(
        layout.unnamedInteractive,
        [],
        `${pageName}/${viewportName}: every visible interactive element must have an accessible name`
      )
      if (pageName === 'editor' && width <= 760) {
        assert.equal(
          layout.projectMenuButtonVisible,
          true,
          `${pageName}/${viewportName}: hidden project actions must have a visible menu`
        )
      }
      await page.screenshot({
        path: `/tmp/stackchan-${pageName}-${viewportName}.png`,
        fullPage: true,
      })
      if (pageName === 'editor' && viewportName === 'desktop') {
        const stressLayout = await page.evaluate(() => {
          const section = document.querySelector('.build-section')
          const status = document.querySelector('#build-status')
          const assetSummary = document.querySelector('#asset-summary')
          const originalStatus = status.textContent
          status.textContent =
            'ビルド成功: very-long-project-name-without-any-break-opportunity-012345678901234567890123456789.xsa'

          const chip = document.createElement('span')
          chip.className = 'asset-chip'
          const label = document.createElement('span')
          label.className = 'asset-chip-label'
          label.textContent =
            'extremely-long-face-asset-name-without-any-break-opportunity-012345678901234567890123456789.stackchan-face.json'
          const remove = document.createElement('button')
          remove.type = 'button'
          remove.textContent = '×'
          chip.append(label, remove)
          assetSummary.append(chip)

          const sectionRect = section.getBoundingClientRect()
          const buttonRects = [...section.querySelectorAll('button')].map((button) => button.getBoundingClientRect())
          const result = {
            sectionOverflow: section.scrollWidth - section.clientWidth,
            buttonOverflow: Math.max(...buttonRects.map((rect) => rect.right - sectionRect.right), 0),
          }
          chip.remove()
          status.textContent = originalStatus
          return result
        })
        assert.equal(stressLayout.sectionOverflow, 0, 'editor build section must contain long status and asset names')
        assert.equal(stressLayout.buttonOverflow <= 0.5, true, 'editor build buttons must remain inside their section')
      }
      if (pageName === 'home' && viewportName === 'desktop') {
        await page.locator('.tool-menu-button').click()
        await page.locator('#tool-drawer[open]').waitFor({ state: 'visible' })
        assert.equal(await page.locator('#tool-drawer .tool-drawer-link').count(), 7)
        assert.match(await page.locator('#tool-drawer [aria-current="page"]').innerText(), /ホーム/)
        await page.screenshot({ path: '/tmp/stackchan-tool-drawer.png', fullPage: true })
        await page.keyboard.press('Escape')
        await page.locator('#tool-drawer').waitFor({ state: 'hidden' })
      }
      if (pageName === 'face-editor' && viewportName === 'desktop') {
        assert.equal(await page.locator('#mouth-open').inputValue(), '0')
        assert.equal(await page.locator('#mouth-open-output').innerText(), '0.00')
        assert.equal(await page.locator('#left-eye-shape').inputValue(), 'circle')
        assert.equal(await page.locator('#left-eye-radius').isVisible(), true)
        assert.equal(await page.locator('#left-eye-width').isVisible(), false)
        assert.equal(await page.locator('#mouth-visible').isChecked(), true)
        await page.locator('#face-name').fill('あつい顔')
        await page.locator('#face-emotion').selectOption('HOT')
        await page.locator('#primary-color').fill('#ff7040')
        await page.locator('#secondary-color').fill('#301010')
        await page.locator('#mouth-open').fill('0.8')
        await page.locator('#left-eye-shape').selectOption('roundRect')
        await page.locator('#left-eye-x').fill('46')
        await page.locator('#left-eye-width').fill('30')
        await page.locator('#left-eye-height').fill('18')
        await page.locator('#left-eye-r').fill('5')
        await page.locator('#right-eye-radius').fill('12')
        await page.locator('#mouth-max-width').fill('108')
        await page.locator('#mouth-visible').uncheck()
        assert.equal(await page.locator('#left-eyelid-width').isEditable(), false)
        assert.equal(await page.locator('#left-eyelid-height').isEditable(), false)
        assert.equal(await page.locator('#left-eye-radius').isVisible(), false)
        assert.equal(await page.locator('#left-eye-width').isVisible(), true)
        assert.equal(await page.locator('#left-eyelid-width').inputValue(), '30')
        assert.equal(await page.locator('#left-eyelid-height').inputValue(), '18')
        assert.equal(await page.locator('#right-eyelid-width').inputValue(), '24')
        assert.equal(await page.locator('#right-eyelid-height').inputValue(), '24')
        assert.equal(await page.locator('#left-eye-iris').getAttribute('data-shape'), 'roundRect')
        assert.equal(await page.locator('#left-eye-iris').getAttribute('width'), '30')
        assert.equal(await page.locator('#left-eye-iris').getAttribute('height'), '18')
        assert.equal(await page.locator('#left-eye-iris').getAttribute('rx'), '5')
        assert.equal(await page.locator('#mouth-part').isVisible(), false)
        assert.equal(await page.locator('#mouth-open').isEnabled(), false)
        assert.equal(await page.locator('#mouth-preview').getAttribute('rx'), null)
        assert.equal(await page.locator('#face-canvas').getAttribute('data-emotion'), 'HOT')
        assert.match(await page.locator('#shape-code-preview').textContent(), /new Eye\(\{ cx: 46/)
        assert.match(await page.locator('#shape-code-preview').textContent(), /shape: 'roundRect'/)
        assert.doesNotMatch(await page.locator('#shape-code-preview').textContent(), /new Mouth/)
        const faceDownload = await captureBrowserDownload(page, () => page.locator('#download-face').click())
        assert.equal(faceDownload.download.suggestedFilename(), 'あつい顔.stackchan-face.json')
        assert.equal(faceDownload.type, 'application/vnd.stackchan.face+json')
        const downloadedFace = JSON.parse(faceDownload.bytes.toString('utf8'))
        assert.equal(downloadedFace.format, 'tech.stackchan.face')
        assert.equal(downloadedFace.version, 1)
        assert.equal(downloadedFace.kind, 'shape')
        assert.equal(downloadedFace.name, 'あつい顔')
        assert.equal(downloadedFace.emotion, 'HOT')
        assert.deepEqual(downloadedFace.colors, { primary: '#ff7040', secondary: '#301010' })
        assert.equal(downloadedFace.mouth, 0.8)
        assert.deepEqual(downloadedFace.canvas, { left: 60, top: 60, width: 200, height: 120 })
        assert.equal(downloadedFace.shape.eyes.left.x, 46)
        assert.equal(downloadedFace.shape.eyes.left.shape, 'roundRect')
        assert.equal(downloadedFace.shape.eyes.left.width, 30)
        assert.equal(downloadedFace.shape.eyes.left.height, 18)
        assert.equal(downloadedFace.shape.eyes.left.r, 5)
        assert.equal(downloadedFace.shape.eyes.left.eyelidWidth, 30)
        assert.equal(downloadedFace.shape.eyes.left.eyelidHeight, 18)
        assert.equal(downloadedFace.shape.eyes.right.shape, 'circle')
        assert.equal(downloadedFace.shape.eyes.right.radius, 12)
        assert.equal(downloadedFace.shape.eyes.right.eyelidWidth, 24)
        assert.equal(downloadedFace.shape.eyes.right.eyelidHeight, 24)
        assert.equal(downloadedFace.shape.mouth.visible, false)
        assert.equal(downloadedFace.shape.mouth.maxWidth, 108)
        await page.locator('#reset-face').click()
        assert.equal(await page.locator('#left-eye-x').inputValue(), '30')
        assert.equal(await page.locator('#left-eye-shape').inputValue(), 'circle')
        assert.equal(await page.locator('#left-eyelid-width').inputValue(), '16')
        assert.equal(await page.locator('#left-eyelid-height').inputValue(), '16')
        assert.equal(await page.locator('#mouth-open').inputValue(), '0')
        assert.equal(await page.locator('#mouth-open-output').innerText(), '0.00')
        assert.equal(await page.locator('#mouth-visible').isChecked(), true)
        assert.equal(await page.locator('#mouth-part').isVisible(), true)
        assert.equal(await page.locator('#mouth-open').isEnabled(), true)
        const faceChooserPromise = page.waitForEvent('filechooser')
        await page.locator('#load-face').click()
        const faceChooser = await faceChooserPromise
        await faceChooser.setFiles({
          name: 'あつい顔.stackchan-face.json',
          mimeType: 'application/vnd.stackchan.face+json',
          buffer: faceDownload.bytes,
        })
        await page.waitForFunction(() => document.querySelector('#left-eye-x')?.value === '46')
        assert.equal(await page.locator('#left-eye-x').inputValue(), '46')
        assert.equal(await page.locator('#left-eye-shape').inputValue(), 'roundRect')
        assert.equal(await page.locator('#left-eye-width').inputValue(), '30')
        assert.equal(await page.locator('#left-eye-height').inputValue(), '18')
        assert.equal(await page.locator('#left-eye-r').inputValue(), '5')
        assert.equal(await page.locator('#right-eye-radius').inputValue(), '12')
        assert.equal(await page.locator('#mouth-max-width').inputValue(), '108')
        assert.equal(await page.locator('#mouth-visible').isChecked(), false)
        assert.equal(await page.locator('#mouth-part').isVisible(), false)
        const dragPoints = await page.evaluate(() => {
          const svg = document.querySelector('#face-canvas')
          const matrix = svg.getScreenCTM()
          const point = (x, y) => {
            const transformed = new DOMPoint(x, y).matrixTransform(matrix)
            return { x: transformed.x, y: transformed.y }
          }
          return {
            start: point(60 + 46, 60 + 33),
            end: point(60 + 70, 60 + 45),
          }
        })
        await page.mouse.move(dragPoints.start.x, dragPoints.start.y)
        await page.mouse.down()
        await page.mouse.move(dragPoints.end.x, dragPoints.end.y, { steps: 4 })
        await page.mouse.up()
        const draggedLeftX = Number(await page.locator('#left-eye-x').inputValue())
        const draggedLeftY = Number(await page.locator('#left-eye-y').inputValue())
        assert.equal(Math.abs(draggedLeftX - 70) <= 1, true)
        assert.equal(Math.abs(draggedLeftY - 45) <= 1, true)
        await page.screenshot({
          path: '/tmp/stackchan-face-editor-hot.png',
          fullPage: true,
        })
        await page.locator('#send-to-editor').click()
        await page.waitForURL(/\/editor\/?\?face-asset=staging/)
        await page.locator('#asset-summary').filter({ hasText: 'あつい顔.stackchan-face.json' }).waitFor()
        assert.equal(await page.locator('#face-selection-label').innerText(), 'あつい顔')
        assert.doesNotMatch(await page.locator('#asset-summary').innerText(), /使用中|使う/)
        assert.match(await page.locator('#code-preview').innerText(), /FaceBase\.template/)
        assert.match(
          await page.locator('#code-preview').innerText(),
          new RegExp(`new Eye\\(\\{ cx: ${draggedLeftX}, cy: ${draggedLeftY}`)
        )
        assert.match(await page.locator('#code-preview').innerText(), /shape: 'roundRect'/)
        assert.doesNotMatch(
          await page.locator('#code-preview').innerText(),
          /new Mouth|import \{ Mouth \}|setMouthOpen/
        )
        assert.match(await page.locator('#code-preview').innerText(), /robot\.ui\.setFace/)
        assert.match(await page.locator('#code-preview').innerText(), /setEmotion\(Emotion\.HOT\)/)
        await page.locator('#face-selection-button').click()
        const faceOptions = page.locator('.face-selection-option')
        assert.equal(await faceOptions.count(), 2)
        assert.equal(await faceOptions.filter({ hasText: 'あつい顔' }).getAttribute('aria-checked'), 'true')
        await page.locator('.face-selection-option[data-face-asset=""]').click()
        assert.equal(await page.locator('#face-selection-label').innerText(), '標準Face')
        assert.doesNotMatch(await page.locator('#code-preview').innerText(), /_StackchanVisualShapeFace/)
        await page.locator('#face-selection-button').click()
        await faceOptions.filter({ hasText: 'あつい顔' }).click()
        assert.equal(await page.locator('#face-selection-label').innerText(), 'あつい顔')
        assert.match(await page.locator('#code-preview').innerText(), /_StackchanVisualShapeFace/)
        await page.screenshot({ path: '/tmp/stackchan-editor-face-selection.png', fullPage: true })
        await page.locator('#build-button').click()
        await page.waitForFunction(() => document.querySelector('#build-status')?.textContent.includes('ビルド成功'))
        await page.locator('#install-simulator-button').click()
        await page.locator('#simulator-dialog[open]').waitFor({ state: 'visible' })
        await page.waitForFunction(() => document.querySelector('#simulator-frame')?.dataset.runCount === '1')
        await page.screenshot({ path: '/tmp/stackchan-face-asset-simulator.png', fullPage: true })
        await page.locator('#simulator-close').click()
      }
      if (pageName === 'editor' && viewportName === 'desktop') {
        assert.match(await page.locator('#code-preview').innerText(), /旧形式から移行/, 'legacy workspace migration')
        const projectNamePencil = page.locator('#project-name-display svg')
        await page.locator('#project-name-display').hover()
        await page.waitForFunction(
          () => Number(getComputedStyle(document.querySelector('#project-name-display svg')).opacity) > 0.95
        )
        assert.equal(
          (await projectNamePencil.evaluate((element) => Number(getComputedStyle(element).opacity))) > 0.95,
          true
        )
        await page.locator('#project-name-display').click()
        await page.locator('#project-name').fill('名前の編集テスト')
        await page.locator('#project-name').press('Enter')
        assert.equal(await page.locator('#project-name-label').innerText(), '名前の編集テスト')
        await page.locator('#project-name-display').click()
        await page.locator('#project-name').fill('はじめてのMOD')
        await page.locator('#project-name').press('Enter')

        const blockPath = page.locator('.blocklyBlockCanvas .blocklyDraggable .blocklyPath').first()
        await blockPath.hover({ force: true })
        assert.equal(
          await blockPath.evaluate((element) => getComputedStyle(element).cursor),
          'pointer',
          'Blockly block hover cursor must remain visible'
        )
        assert.equal(await page.locator('.target-device-control svg').count(), 1, 'target device has a visible icon')
        assert.equal(
          await page.locator('.project-controls #recent-projects-button').count(),
          0,
          'recent projects are removed from the header'
        )
        await openProjectMenu(page)
        const recentProjectsButton = page.locator('#recent-projects-button')
        const recentProjectsSubmenu = page.locator('#recent-projects-submenu')
        assert.equal(await recentProjectsButton.isVisible(), true)
        await recentProjectsButton.hover()
        await recentProjectsSubmenu.waitFor({ state: 'visible' })
        const submenuPlacement = await page.evaluate(() => {
          const trigger = document.querySelector('#recent-projects-button').getBoundingClientRect()
          const submenu = document.querySelector('#recent-projects-submenu').getBoundingClientRect()
          return { triggerLeft: trigger.left, submenuRight: submenu.right }
        })
        assert.equal(
          submenuPlacement.submenuRight <= submenuPlacement.triggerLeft,
          true,
          'desktop recent projects submenu opens to the side'
        )
        assert.equal((await page.locator('.recent-project-item').count()) >= 1, true)
        await page.screenshot({ path: '/tmp/stackchan-editor-project-submenu.png', fullPage: true })
        await page.mouse.move(0, 0)
        await recentProjectsSubmenu.waitFor({ state: 'hidden' })
        await page.keyboard.press('Escape')

        const sourceBeforeClear = await page.locator('#code-preview').innerText()
        await clickProjectAction(page, 'clear-button')
        await page.locator('#clear-workspace-dialog[open]').waitFor({ state: 'visible' })
        assert.match(await page.locator('#clear-workspace-project-name').innerText(), /はじめてのMOD/)
        await page.screenshot({ path: '/tmp/stackchan-editor-clear-confirm.png', fullPage: true })
        await page.locator('#clear-workspace-cancel').click()
        await page.locator('#clear-workspace-dialog').waitFor({ state: 'hidden' })
        assert.equal(await page.locator('#code-preview').innerText(), sourceBeforeClear, 'cancel keeps the workspace')
        await clickProjectAction(page, 'clear-button')
        await page.locator('#clear-workspace-confirm').click()
        await page.locator('#clear-workspace-dialog').waitFor({ state: 'hidden' })
        await page.waitForFunction(() => document.querySelector('#diagnostics-list')?.textContent.includes('VP_EMPTY'))
        assert.match(await page.locator('#build-status').innerText(), /ワークスペースを消去しました/)
        await page.locator('#code-tab').focus()
        await page.keyboard.press('ArrowRight')
        assert.equal(await page.locator('#log-tab').getAttribute('aria-selected'), 'true', 'keyboard tab navigation')
        await page.keyboard.press('End')
        assert.equal(await page.locator('#diagnostics-tab').getAttribute('aria-selected'), 'true')
        await page.keyboard.press('Home')
        assert.equal(await page.locator('#code-tab').getAttribute('aria-selected'), 'true')
        await clickProjectAction(page, 'sample-button')
        await page.locator('#sample-dialog[open]').waitFor({ state: 'visible' })
        assert.equal(await page.locator('.sample-card').count(), 5, 'editor: five samples must be available')
        await page.keyboard.press('Escape')
        await page.locator('#sample-dialog').waitFor({ state: 'hidden' })
        await clickProjectAction(page, 'sample-button')
        await page.locator('#sample-dialog[open]').waitFor({ state: 'visible' })
        const sampleIds = ['hello', 'buttons', 'timer-motion', 'sensors', 'logic']
        for (const [index, sampleId] of sampleIds.entries()) {
          if (index > 0) {
            await clickProjectAction(page, 'sample-button')
            await page.locator('#sample-dialog[open]').waitFor({ state: 'visible' })
          }
          await page.locator(`[data-sample-id="${sampleId}"]`).click()
          assert.equal(await page.locator('#diagnostics-count').innerText(), '0', `${sampleId}: diagnostics`)
          assert.equal(await page.locator('#install-simulator-button').isEnabled(), false, `${sampleId}: stale build`)
          await page.locator('#build-button').click()
          await page.waitForFunction(() => document.querySelector('#build-status')?.textContent.includes('ビルド成功'))
          assert.equal(await page.locator('#install-simulator-button').isEnabled(), true, `${sampleId}: build`)
        }

        const singingProjectChooserPromise = page.waitForEvent('filechooser')
        await clickProjectAction(page, 'import-button')
        const singingProjectChooser = await singingProjectChooserPromise
        await singingProjectChooser.setFiles({
          name: 'singing-score.stackchan-blocks.json',
          mimeType: 'application/json',
          buffer: Buffer.from(
            JSON.stringify({
              blocks: {
                languageVersion: 0,
                blocks: [
                  {
                    type: 'stackchan_on_drawer_button',
                    fields: { LABEL: 'うたう' },
                    inputs: {
                      DO: {
                        block: {
                          type: 'stackchan_sing_score',
                          fields: { BPM: 120 },
                          inputs: {
                            SCORE: {
                              block: {
                                type: 'lists_create_with',
                                extraState: { itemCount: 3 },
                                inputs: {
                                  ADD0: {
                                    block: {
                                      type: 'stackchan_song_note_tuple',
                                      fields: { NOTE: 'C4', BEATS: 1, LYRIC: 'き' },
                                    },
                                  },
                                  ADD1: {
                                    block: {
                                      type: 'stackchan_song_note_tuple',
                                      fields: { NOTE: 'C4', BEATS: 1, LYRIC: 'ら' },
                                    },
                                  },
                                  ADD2: {
                                    block: {
                                      type: 'stackchan_song_rest_tuple',
                                      fields: { BEATS: 0.5 },
                                    },
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                ],
              },
            })
          ),
        })
        await page.waitForFunction(() =>
          document.querySelector('#build-status')?.textContent.includes('読み込みました')
        )
        assert.equal(await page.locator('#diagnostics-count').innerText(), '0', 'singing score diagnostics')
        const singingSource = await page.locator('#code-preview').innerText()
        assert.match(singingSource, /function singingScoreToKoe/)
        assert.match(singingSource, /await singScore\(robot, 120/)
        assert.match(singingSource, /\['C4', 1, 'き'\]/)
        assert.match(singingSource, /\['C4', 1, 'ら'\]/)
        assert.match(singingSource, /\['R', 0\.5, ''\]/)
        await page.locator('#build-button').click()
        await page.waitForFunction(() => document.querySelector('#build-status')?.textContent.includes('ビルド成功'))

        assert.match(await page.locator('#build-status').innerText(), /ビルド成功: (?!0 B)/)
        const archiveDownload = await captureBrowserDownload(page, () => page.locator('#download-button').click())
        assert.match(archiveDownload.download.suggestedFilename(), /\.xsa$/)
        assert.equal(archiveDownload.bytes.subarray(4, 8).toString(), 'XS_A', 'downloaded build must be an XSA')
        assert.match(await page.locator('#code-preview').innerText(), /visualLoopGuard\([^)]/)
        assert.equal(await page.locator('#install-device-button').isEnabled(), true, 'CoreS3 device install target')
        assert.equal(await page.locator('#restore-device-button').count(), 0, 'automatic backup restore is removed')
        assert.equal(await page.locator('#remove-device-button').isEnabled(), true, 'CoreS3 MOD removal target')
        await page.locator('#target-device').selectOption('simulator')
        await page.locator('#build-button').click()
        await page.waitForFunction(() => document.querySelector('#build-status')?.textContent.includes('ビルド成功'))
        assert.equal(
          await page.locator('#install-device-button').isEnabled(),
          false,
          'simulator target must never enable device install'
        )
        assert.equal(
          await page.locator('#remove-device-button').isEnabled(),
          false,
          'simulator target must never enable device removal'
        )
        await page.locator('#target-device').selectOption('m5stackchan-cores3')
        await clickProjectAction(page, 'duplicate-project-button')
        assert.match(await page.locator('#project-name').inputValue(), /のコピー$/)
        assert.equal((await page.locator('.recent-project-item').count()) >= 2, true)
        const projectDownload = await captureBrowserDownload(page, () => clickProjectAction(page, 'export-button'))
        assert.match(projectDownload.download.suggestedFilename(), /\.stackchan-blocks\.json$/)
        const downloadedProject = JSON.parse(projectDownload.bytes.toString('utf8'))
        assert.equal(downloadedProject.format, 'tech.stackchan.visual-project')
        assert.equal(downloadedProject.version, 1)
        assert.equal(
          await page.locator('#install-simulator-button').isEnabled(),
          false,
          'duplicating invalidates archive'
        )
        await page.locator('#build-button').click()
        await page.waitForFunction(() => document.querySelector('#build-status')?.textContent.includes('ビルド成功'))
        await page.locator('#install-simulator-button').click()
        await page.locator('#simulator-dialog[open]').waitFor({ state: 'visible' })
        const simulatorFrame = page.frameLocator('#simulator-frame')
        await simulatorFrame.locator('#simulator-info').filter({ hasText: '準備完了' }).waitFor({ state: 'visible' })
        assert.match(await simulatorFrame.locator('#mod-install-status').innerText(), /起動準備済み/)
        await page.waitForFunction(() => document.querySelector('#simulator-frame')?.dataset.runCount === '1')
        await page.screenshot({
          path: '/tmp/stackchan-editor-simulator.png',
          fullPage: true,
        })
        await page.locator('#simulator-restart').click()
        await page.waitForFunction(() => document.querySelector('#simulator-frame')?.dataset.runCount === '2')
        assert.match(await page.locator('#build-status').innerText(), /2回目/)
        await page.locator('#simulator-stop').click()
        assert.equal(await page.locator('#simulator-frame').getAttribute('src'), 'about:blank')
        await page.locator('#simulator-close').click()
        const metricsReport = await page.evaluate(async () => {
          const { createMetricsReport } = await import('./metrics.mjs')
          const events = JSON.parse(localStorage.getItem('stackchan-visual-metrics-v1') ?? '[]')
          return createMetricsReport(events, {
            project: document.querySelector('#project-name').value,
            target: document.querySelector('#target-device').value,
          })
        })
        assert.equal(metricsReport.format, 'tech.stackchan.visual-metrics')
        assert.equal(metricsReport.context.target, 'm5stackchan-cores3')
        assert.equal(Number.isFinite(metricsReport.summary.firstBuildMs), true)
        assert.equal(Number.isFinite(metricsReport.summary.firstSimulatorMs), true)
        assert.equal(
          metricsReport.summary.firstSimulatorMs <= 15 * 60 * 1000,
          true,
          `scripted first-run flow must remain within 15 minutes: ${metricsReport.summary.firstSimulatorMs} ms`
        )
        assert.equal(
          metricsReport.events.some((event) => event.event === 'build_succeeded'),
          true
        )
        assert.equal(
          metricsReport.events.some((event) => event.event === 'simulator_succeeded'),
          true
        )

        const assetChooserPromise = page.waitForEvent('filechooser')
        await clickProjectAction(page, 'asset-button')
        const assetChooser = await assetChooserPromise
        await assetChooser.setFiles({
          name: 'browser-test.stackchan-face.json',
          mimeType: 'application/vnd.stackchan.face+json',
          buffer: Buffer.from(
            JSON.stringify({
              format: 'tech.stackchan.face',
              version: 1,
              kind: 'shape',
              name: 'ブラウザ確認',
              emotion: 'HAPPY',
              colors: { primary: '#30e0ff', secondary: '#202020' },
              mouth: 0.4,
              canvas: { left: 60, top: 60, width: 200, height: 120 },
              shape: {
                eyes: {
                  left: { x: 30, y: 33, radius: 8, eyelidWidth: 24, eyelidHeight: 24 },
                  right: { x: 170, y: 36, radius: 8, eyelidWidth: 24, eyelidHeight: 24 },
                },
                mouth: { x: 100, y: 88, minWidth: 50, maxWidth: 90, minHeight: 8, maxHeight: 58 },
              },
            })
          ),
        })
        await page.locator('#asset-summary').filter({ hasText: 'browser-test.stackchan-face.json' }).waitFor()
        assert.match(await page.locator('#code-preview').innerText(), /setEmotion\(Emotion\.HAPPY\)/)
        assert.equal(
          await page.locator('#install-simulator-button').isEnabled(),
          false,
          'adding an asset invalidates archive'
        )
        await page.locator('#build-button').click()
        await page.waitForFunction(() => document.querySelector('#build-status')?.textContent.includes('ビルド成功'))
        assert.equal(await page.locator('#install-simulator-button').isEnabled(), true, 'face asset build')

        await page.reload({ waitUntil: 'domcontentloaded' })
        await page.locator('#asset-summary').filter({ hasText: 'browser-test.stackchan-face.json' }).waitFor()
        assert.match(await page.locator('#code-preview').innerText(), /setEmotion\(Emotion\.HAPPY\)/)
        assert.equal(await page.locator('#embed-assets').isChecked(), true)
        assert.equal((await page.locator('.recent-project-item').count()) >= 2, true, 'IndexedDB recent projects')
        assert.equal(
          await page.locator('#install-simulator-button').isEnabled(),
          false,
          'a persisted project must be rebuilt after reload'
        )
        await page.locator('#embed-assets').uncheck()
        await page.waitForFunction(
          () =>
            new Promise((resolve) => {
              const request = indexedDB.open('stackchan-visual-projects', 1)
              request.onsuccess = () => {
                const database = request.result
                const stateRequest = database
                  .transaction('project-state', 'readonly')
                  .objectStore('project-state')
                  .get('current')
                stateRequest.onsuccess = () => {
                  const disabled = stateRequest.result?.currentProject?.settings?.embedAssets === false
                  database.close()
                  resolve(disabled)
                }
                stateRequest.onerror = () => resolve(false)
              }
              request.onerror = () => resolve(false)
            })
        )
        await page.reload({ waitUntil: 'domcontentloaded' })
        await page.locator('#asset-summary').filter({ hasText: 'browser-test.stackchan-face.json' }).waitFor()
        assert.equal(await page.locator('#embed-assets').isChecked(), false, 'asset embedding setting persists')
        await page.locator('#embed-assets').check()

        const largeAssetChooserPromise = page.waitForEvent('filechooser')
        await clickProjectAction(page, 'asset-button')
        const largeAssetChooser = await largeAssetChooserPromise
        await largeAssetChooser.setFiles([
          {
            name: 'large-a.bin',
            mimeType: 'application/octet-stream',
            buffer: Buffer.alloc(1900 * 1024, 0x5a),
          },
          {
            name: 'large-b.bin',
            mimeType: 'application/octet-stream',
            buffer: Buffer.alloc(1900 * 1024, 0xa5),
          },
        ])
        await page.locator('#asset-summary').filter({ hasText: 'large-a.bin' }).waitFor()
        await page.locator('#asset-summary').filter({ hasText: 'large-b.bin' }).waitFor()
        await page.waitForFunction(
          () =>
            new Promise((resolve) => {
              const openRequest = indexedDB.open('stackchan-visual-projects', 1)
              openRequest.onerror = () => resolve(false)
              openRequest.onsuccess = () => {
                const database = openRequest.result
                const request = database
                  .transaction('project-state', 'readonly')
                  .objectStore('project-state')
                  .get('current')
                request.onerror = () => {
                  database.close()
                  resolve(false)
                }
                request.onsuccess = () => {
                  const serializedSize = new TextEncoder().encode(
                    JSON.stringify(request.result?.currentProject ?? {})
                  ).length
                  database.close()
                  resolve(serializedSize > 5 * 1024 * 1024)
                }
              }
            })
        )
        await page.reload({ waitUntil: 'domcontentloaded' })
        await page.locator('#asset-summary').filter({ hasText: 'large-a.bin' }).waitFor()
        await page.locator('#asset-summary').filter({ hasText: 'large-b.bin' }).waitFor()

        const runtimeProjectChooserPromise = page.waitForEvent('filechooser')
        await clickProjectAction(page, 'import-button')
        const runtimeProjectChooser = await runtimeProjectChooserPromise
        await runtimeProjectChooser.setFiles({
          name: 'runtime-diagnostic.stackchan-blocks.json',
          mimeType: 'application/json',
          buffer: Buffer.from(
            JSON.stringify({
              blocks: {
                languageVersion: 0,
                blocks: [
                  {
                    type: 'stackchan_on_button',
                    id: 'runtime-event',
                    x: 24,
                    y: 24,
                    fields: { BUTTON: 'a', EDGE: 'press' },
                    inputs: {
                      DO: {
                        block: {
                          type: 'controls_whileUntil',
                          id: 'runtime-loop',
                          fields: { MODE: 'WHILE' },
                          inputs: {
                            BOOL: {
                              block: {
                                type: 'logic_boolean',
                                fields: { BOOL: 'TRUE' },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                ],
              },
            })
          ),
        })
        await page.waitForFunction(() =>
          document.querySelector('#build-status')?.textContent.includes('読み込みました')
        )
        assert.equal(await page.locator('#diagnostics-count').innerText(), '1', 'unbounded loop warning')
        await page.locator('#build-button').click()
        await page.waitForFunction(() => document.querySelector('#build-status')?.textContent.includes('ビルド成功'))
        await page.locator('#install-simulator-button').click()
        await page.locator('#simulator-dialog[open]').waitFor({ state: 'visible' })
        await page.waitForFunction(() => document.querySelector('#simulator-frame')?.dataset.runCount === '1')
        await simulatorFrame
          .locator('#trace-log')
          .filter({ hasText: '[main] app behaviors ready' })
          .waitFor({ state: 'visible' })
        await page.locator('[data-simulator-button="a"]').click()
        await page.waitForFunction(() =>
          document.querySelector('#log-output')?.textContent.includes('VP_RUNTIME_HANDLER')
        )
        assert.equal(
          await page.locator('#log-tab').getAttribute('aria-selected'),
          'true',
          'runtime error opens log tab'
        )
        const runtimeSelection = await page.evaluate(() => {
          const block = globalThis.Blockly?.getMainWorkspace?.()?.getBlockById('runtime-loop')
          return {
            rootClass: block?.getSvgRoot?.()?.getAttribute('class') ?? null,
          }
        })
        assert.match(runtimeSelection.rootClass ?? '', /blocklySelected/, JSON.stringify(runtimeSelection))
        await page.locator('#simulator-close').click()

        await page.evaluate(() => {
          const generator = globalThis.javascript?.javascriptGenerator
          globalThis.__stackchanOriginalWorkspaceToCode = generator.workspaceToCode
          generator.workspaceToCode = () => {
            throw new Error('forced generation failure')
          }
        })
        await page.locator('#build-button').click()
        await page.locator('.diagnostic-code').filter({ hasText: 'VP_CODE_GENERATION_FAILED' }).waitFor()
        assert.match(await page.locator('#code-preview').innerText(), /forced generation failure/)
        assert.equal(await page.locator('#build-button').isEnabled(), false, 'generation failure disables stale build')
        assert.equal(
          await page.locator('#install-simulator-button').isEnabled(),
          false,
          'generation failure invalidates the previous archive'
        )
        await page.evaluate(() => {
          const generator = globalThis.javascript?.javascriptGenerator
          generator.workspaceToCode = globalThis.__stackchanOriginalWorkspaceToCode
          delete globalThis.__stackchanOriginalWorkspaceToCode
          document.querySelector('#target-device').dispatchEvent(new Event('change', { bubbles: true }))
        })
        await page.waitForFunction(
          () => !document.querySelector('#code-preview')?.textContent.includes('forced generation failure')
        )

        const fileChooserPromise = page.waitForEvent('filechooser')
        await clickProjectAction(page, 'import-button')
        const fileChooser = await fileChooserPromise
        await fileChooser.setFiles({
          name: 'corrupt.stackchan-blocks.json',
          mimeType: 'application/json',
          buffer: Buffer.from('{broken json'),
        })
        await page.waitForTimeout(500)
        await openProjectMenu(page)
        const recoveryState = {
          status: await page.locator('#build-status').innerText(),
          visible: await page.locator('#recovery-button').isVisible(),
          log: await page.locator('#log-output').innerText(),
        }
        assert.equal(recoveryState.status, 'プロジェクトを読み込めませんでした')
        assert.equal(recoveryState.visible, true, JSON.stringify(recoveryState))
        assert.match(recoveryState.log, /JSONを解析できません/, JSON.stringify(recoveryState))
        const recoveryDownload = await captureBrowserDownload(page, () => page.locator('#recovery-button').click())
        const recovery = JSON.parse(recoveryDownload.bytes.toString('utf8'))
        assert.equal(recovery.raw, '{broken json')
        assert.match(recovery.error, /JSONを解析できません/)

        await page.evaluate(
          () =>
            new Promise((resolve, reject) => {
              const request = indexedDB.open('stackchan-visual-projects', 1)
              request.onerror = () => reject(request.error)
              request.onsuccess = () => {
                const database = request.result
                const transaction = database.transaction('project-state', 'readwrite')
                transaction.objectStore('project-state').put(
                  {
                    version: 1,
                    currentProject: { format: 'corrupt-indexeddb-state' },
                    projects: [],
                  },
                  'current'
                )
                transaction.oncomplete = () => {
                  database.close()
                  resolve()
                }
                transaction.onerror = () => reject(transaction.error)
              }
            })
        )
        await page.reload({ waitUntil: 'domcontentloaded' })
        await page.waitForFunction(() =>
          document.querySelector('#log-output')?.textContent.includes('IndexedDBのプロジェクトを復元できませんでした')
        )
        await openProjectMenu(page)
        await page.locator('#recovery-button').waitFor({ state: 'visible' })
      }
      if (pageName === 'editor' && viewportName === 'mobile') {
        await openProjectMenu(page)
        for (const actionId of [
          'new-project-button',
          'duplicate-project-button',
          'import-button',
          'export-button',
          'asset-button',
          'sample-button',
          'recovery-button',
          'clear-button',
        ]) {
          assert.equal(await page.locator(`#${actionId}`).isVisible(), true, `mobile project menu exposes ${actionId}`)
        }
        assert.equal((await page.locator('#mobile-target-device option').count()) >= 3, true)
        assert.equal(await page.locator('#recent-projects-button').isVisible(), true)
        await page.locator('#recent-projects-button').click()
        await page.locator('#recent-projects-submenu').waitFor({ state: 'visible' })
        assert.equal((await page.locator('.recent-project-item').count()) >= 1, true)
        await page.screenshot({ path: '/tmp/stackchan-editor-mobile-menu.png', fullPage: true })
        await page.locator('#mobile-target-device').selectOption('simulator')
        assert.equal(await page.locator('#target-device').inputValue(), 'simulator')
        await page.locator('#mobile-target-device').selectOption('m5stackchan-cores3')
        await page.locator('#duplicate-project-button').click()
        assert.match(await page.locator('#project-name').inputValue(), /のコピー$/)
        await openProjectMenu(page)
        await page.locator('#recent-projects-button').click()
        const recentProjectItems = page.locator('.recent-project-item')
        assert.equal((await recentProjectItems.count()) >= 2, true)
        const previousProjectName = await recentProjectItems.nth(1).locator('strong').innerText()
        await recentProjectItems.nth(1).click()
        assert.equal(await page.locator('#project-name-label').innerText(), previousProjectName)
        await page.locator('#project-menu').waitFor({ state: 'hidden' })
      }
    }
  }

  const integrityContext = await browser.newContext()
  const integrityPage = await integrityContext.newPage()
  const integrityMessages = []
  integrityPage.on('console', (message) => integrityMessages.push(message.text()))
  await integrityPage.route('https://unpkg.com/three@0.164.1/build/three.module.js', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      headers: { 'access-control-allow-origin': '*' },
      body: "export const REVISION = 'tampered'\n",
    })
  )
  await integrityPage.goto(`${baseUrl}/simulator/`, {
    waitUntil: 'domcontentloaded',
  })
  await integrityPage.waitForTimeout(1000)
  assert.match(integrityMessages.join('\n'), /integrity|digest/i, 'tampered Three.js module must be rejected by SRI')
  assert.doesNotMatch(await integrityPage.locator('#simulator-info').innerText(), /準備完了/)
  await integrityContext.close()

  console.log(
    'page visual checks passed: /tmp/stackchan-{home,flash,preference,editor,tutorial,face-editor}-{desktop,mobile}.png and /tmp/stackchan-editor-simulator.png'
  )
} finally {
  await browser?.close()
  server?.kill('SIGTERM')
}
