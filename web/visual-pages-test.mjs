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
      const layout = await page.evaluate(() => {
        const topbar = document.querySelector('.topbar').getBoundingClientRect()
        // Long user-entered text in inputs scrolls horizontally by design; verify
        // fixed action labels and select values instead.
        const interactive = [...document.querySelectorAll('button, a, select')]
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
      await page.screenshot({
        path: `/tmp/stackchan-${pageName}-${viewportName}.png`,
        fullPage: true,
      })
      if (pageName === 'face-editor' && viewportName === 'desktop') {
        await page.locator('#face-name').fill('あつい顔')
        await page.locator('#face-emotion').selectOption('HOT')
        await page.locator('#primary-color').fill('#ff7040')
        await page.locator('#secondary-color').fill('#301010')
        await page.locator('#mouth-open').fill('0.8')
        assert.equal(await page.locator('#face-canvas').getAttribute('data-emotion'), 'HOT')
        const faceDownload = await captureBrowserDownload(page, () => page.locator('#download-face').click())
        assert.equal(faceDownload.download.suggestedFilename(), 'あつい顔.stackchan-face.json')
        assert.equal(faceDownload.type, 'application/vnd.stackchan.face+json')
        assert.deepEqual(JSON.parse(faceDownload.bytes.toString('utf8')), {
          format: 'tech.stackchan.face',
          version: 1,
          name: 'あつい顔',
          emotion: 'HOT',
          colors: { primary: '#ff7040', secondary: '#301010' },
          mouth: 0.8,
        })
        await page.screenshot({
          path: '/tmp/stackchan-face-editor-hot.png',
          fullPage: true,
        })
        await page.locator('#send-to-editor').click()
        await page.waitForURL(/\/editor\/?\?face-asset=staging/)
        await page.locator('#asset-summary').filter({ hasText: 'あつい顔.stackchan-face.json' }).waitFor()
        assert.match(await page.locator('#code-preview').innerText(), /setEmotion\(Emotion\.HOT\)/)
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
        await page.locator('#code-tab').focus()
        await page.keyboard.press('ArrowRight')
        assert.equal(await page.locator('#log-tab').getAttribute('aria-selected'), 'true', 'keyboard tab navigation')
        await page.keyboard.press('End')
        assert.equal(await page.locator('#diagnostics-tab').getAttribute('aria-selected'), 'true')
        await page.keyboard.press('Home')
        assert.equal(await page.locator('#code-tab').getAttribute('aria-selected'), 'true')
        await page.locator('#sample-button').click()
        await page.locator('#sample-dialog[open]').waitFor({ state: 'visible' })
        assert.equal(await page.locator('.sample-card').count(), 5, 'editor: five samples must be available')
        await page.keyboard.press('Escape')
        await page.locator('#sample-dialog').waitFor({ state: 'hidden' })
        await page.locator('#sample-button').click()
        await page.locator('#sample-dialog[open]').waitFor({ state: 'visible' })
        const sampleIds = ['hello', 'buttons', 'timer-motion', 'sensors', 'logic']
        for (const [index, sampleId] of sampleIds.entries()) {
          if (index > 0) {
            await page.locator('#sample-button').click()
            await page.locator('#sample-dialog[open]').waitFor({ state: 'visible' })
          }
          await page.locator(`[data-sample-id="${sampleId}"]`).click()
          assert.equal(await page.locator('#diagnostics-count').innerText(), '0', `${sampleId}: diagnostics`)
          assert.equal(await page.locator('#install-simulator-button').isEnabled(), false, `${sampleId}: stale build`)
          await page.locator('#build-button').click()
          await page.waitForFunction(() => document.querySelector('#build-status')?.textContent.includes('ビルド成功'))
          assert.equal(await page.locator('#install-simulator-button').isEnabled(), true, `${sampleId}: build`)
        }
        assert.match(await page.locator('#build-status').innerText(), /ビルド成功: (?!0 B)/)
        const archiveDownload = await captureBrowserDownload(page, () => page.locator('#download-button').click())
        assert.match(archiveDownload.download.suggestedFilename(), /\.xsa$/)
        assert.equal(archiveDownload.bytes.subarray(4, 8).toString(), 'XS_A', 'downloaded build must be an XSA')
        assert.match(await page.locator('#code-preview').innerText(), /visualLoopGuard\([^)]/)
        assert.equal(await page.locator('#install-device-button').isEnabled(), true, 'CoreS3 device install target')
        assert.equal(await page.locator('#restore-device-button').isEnabled(), true, 'CoreS3 backup restore target')
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
          await page.locator('#restore-device-button').isEnabled(),
          false,
          'simulator target must never enable device restore'
        )
        assert.equal(
          await page.locator('#remove-device-button').isEnabled(),
          false,
          'simulator target must never enable device removal'
        )
        await page.locator('#target-device').selectOption('m5stackchan-cores3')
        await page.locator('#duplicate-project-button').click()
        assert.match(await page.locator('#project-name').inputValue(), /のコピー$/)
        assert.equal((await page.locator('#recent-projects option').count()) >= 3, true)
        const projectDownload = await captureBrowserDownload(page, () => page.locator('#export-button').click())
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
        const metricsDownload = await captureBrowserDownload(page, () => page.locator('#metrics-button').click())
        const metricsReport = JSON.parse(metricsDownload.bytes.toString('utf8'))
        assert.equal(metricsReport.format, 'tech.stackchan.visual-metrics')
        assert.equal(Number.isFinite(metricsReport.summary.firstSimulatorMs), true)

        const assetChooserPromise = page.waitForEvent('filechooser')
        await page.locator('#asset-button').click()
        const assetChooser = await assetChooserPromise
        await assetChooser.setFiles({
          name: 'browser-test.stackchan-face.json',
          mimeType: 'application/vnd.stackchan.face+json',
          buffer: Buffer.from(
            JSON.stringify({
              format: 'tech.stackchan.face',
              version: 1,
              name: 'ブラウザ確認',
              emotion: 'HAPPY',
              colors: { primary: '#30e0ff', secondary: '#202020' },
              mouth: 0.4,
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
        assert.equal((await page.locator('#recent-projects option').count()) >= 3, true, 'IndexedDB recent projects')
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
        await page.locator('#asset-button').click()
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
        await page.locator('#import-button').click()
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

        const fileChooserPromise = page.waitForEvent('filechooser')
        await page.locator('#import-button').click()
        const fileChooser = await fileChooserPromise
        await fileChooser.setFiles({
          name: 'corrupt.stackchan-blocks.json',
          mimeType: 'application/json',
          buffer: Buffer.from('{broken json'),
        })
        await page.waitForTimeout(500)
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
        await page.locator('#recovery-button').waitFor({ state: 'visible' })
      }
      if (pageName === 'editor' && viewportName === 'mobile') {
        await page.locator('#mobile-project-menu-button').click()
        await page.locator('#mobile-project-dialog[open]').waitFor({ state: 'visible' })
        for (const actionId of [
          'new-project-button',
          'duplicate-project-button',
          'sample-button',
          'metrics-button',
          'recovery-button',
          'tutorial-link',
          'clear-button',
        ]) {
          assert.equal(
            await page.locator(`[data-editor-action="${actionId}"]`).isVisible(),
            true,
            `mobile project menu exposes ${actionId}`
          )
        }
        assert.equal((await page.locator('#mobile-target-device option').count()) >= 3, true)
        assert.equal((await page.locator('#mobile-recent-projects option').count()) >= 1, true)
        await page.screenshot({ path: '/tmp/stackchan-editor-mobile-menu.png', fullPage: true })
        await page.locator('#mobile-target-device').selectOption('simulator')
        assert.equal(await page.locator('#target-device').inputValue(), 'simulator')
        await page.locator('#mobile-target-device').selectOption('m5stackchan-cores3')
        await page.locator('[data-editor-action="duplicate-project-button"]').click()
        assert.match(await page.locator('#project-name').inputValue(), /のコピー$/)
        await page.locator('#mobile-project-menu-button').click()
        assert.equal((await page.locator('#mobile-recent-projects option').count()) >= 2, true)
        await page.locator('#mobile-project-dialog-close').click()
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
