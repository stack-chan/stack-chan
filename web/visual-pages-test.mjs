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

let server
if (!process.env.STACKCHAN_PAGES_TEST_URL) {
  server = spawn(
    process.execPath,
    [
      resolve('node_modules/live-server/live-server.js'),
      `--port=${port}`,
      '--host=127.0.0.1',
      '--no-browser',
      '--quiet',
    ],
    {
      cwd: process.cwd(),
      stdio: 'inherit',
    }
  )
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
]
const viewports = [
  ['desktop', 1280, 800],
  ['mobile', 390, 844],
]

let browser
try {
  await waitForServer()
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] })
  const page = await browser.newPage()
  for (const [viewportName, width, height] of viewports) {
    await page.setViewportSize({ width, height })
    for (const [pageName, pathname] of pages) {
      await page.goto(`${baseUrl}${pathname}`, { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('.topbar')
      const layout = await page.evaluate(() => {
        const topbar = document.querySelector('.topbar').getBoundingClientRect()
        const interactive = [...document.querySelectorAll('button, a, input, select, textarea')]
        return {
          bodyWidth: document.body.scrollWidth,
          topbar: { left: topbar.left, right: topbar.right, height: topbar.height },
          clippedText: interactive.filter((element) => element.scrollWidth > element.clientWidth + 1).length,
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
      assert.equal(layout.clippedText, 0, `${pageName}/${viewportName}: interactive text must not be clipped`)
      assert.equal(layout.visibleHiddenElements, 0, `${pageName}/${viewportName}: hidden controls must not be rendered`)
      await page.screenshot({ path: `/tmp/stackchan-${pageName}-${viewportName}.png`, fullPage: true })
    }
  }
  console.log('page visual checks passed: /tmp/stackchan-{home,flash,preference,editor}-{desktop,mobile}.png')
} finally {
  await browser?.close()
  server?.kill('SIGTERM')
}
