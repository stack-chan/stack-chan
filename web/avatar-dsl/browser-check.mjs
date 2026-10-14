import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { startPreview, resolveChromium } from '../test-preview-server.mjs'
import { runTransferBrowserChecks } from './transfer-browser.test.mjs'
import { createRuntime } from './runtime/index.js'
import { compile } from '../../firmware/tools/avatar-dsl/compiler/compile.js'
import { createContext } from '../../firmware/mods/examples/avatar-dsl/context.js'

const { baseUrl, server } = await startPreview({ port: 8216, url: process.env.STACKCHAN_AVATAR_TEST_URL })
const artifacts = new URL('./artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
const browser = await chromium.launch({
  executablePath: resolveChromium(),
  headless: true,
  args: ['--no-sandbox', '--disable-features=WebMCP'],
})
const evidence = { browser: browser.version(), errors: [], frames: [], physicalDeviceAccess: false }
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true })
  page.on('pageerror', (error) => evidence.errors.push(error.message))
  evidence.transfer = await runTransferBrowserChecks(page, `${baseUrl}/avatar-dsl/`)
  assert.match(await page.locator('#bridge-status').textContent(), /unavailable/)
  await page.locator('#sample').selectOption('sensor')
  await page.waitForFunction(() => !document.getElementById('transfer').disabled)
  const source = await page.locator('#source').inputValue()
  const bytecode = compile(source)
  const runtime = await createRuntime({ wasmBytes: await readFile(new URL('./runtime/avds.wasm', import.meta.url)) })
  for (const open of [1, 0.9, 0.5, 0.1, 0, 1]) {
    await page.locator('#eye').evaluate((element, value) => {
      element.value = String(value)
      element.dispatchEvent(new Event('input'))
    }, open)
    await page.waitForFunction(() => !document.getElementById('transfer').disabled)
    const context = createContext()
    context[5] = open
    context[4] = 1
    const expected = runtime.run(bytecode, context)
    const actual = await page
      .locator('#preview')
      .evaluate((canvas) => Array.from(canvas.getContext('2d').getImageData(0, 0, 320, 240).data))
    assert.deepEqual(Buffer.from(actual), Buffer.from(expected.pixels))
    assert.equal(await page.locator('#source').inputValue(), source, 'openness never regenerates export source')
    evidence.frames.push({ open, steps: expected.steps, primitives: expected.primitives.length })
    if (open === 0.5)
      await page.screenshot({ path: fileURLToPath(new URL('sensor-half.png', artifacts)), fullPage: true })
  }
  const pendingDownload = page.waitForEvent('download')
  await page.locator('#download').click()
  const download = await pendingDownload,
    chunks = []
  for await (const chunk of await download.createReadStream()) chunks.push(chunk)
  assert.equal(Buffer.concat(chunks).toString('utf8'), source)
  evidence.exportMatchesEditor = true
  const before = await page.locator('#preview').evaluate((canvas) => canvas.toDataURL())
  await page.locator('#source').fill('fn draw() while true do end end')
  await page.waitForFunction(() => document.getElementById('diagnostic').dataset.error === 'true')
  assert.ok(await page.locator('#transfer').isDisabled())
  assert.equal(await page.locator('#preview').evaluate((canvas) => canvas.toDataURL()), before)
  await page.locator('#undo').click()
  await page.waitForFunction(() => !document.getElementById('transfer').disabled)
  evidence.invalidLoopBlocksTransferAndUndoRecovers = true
  await page.setViewportSize({ width: 390, height: 844 })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.screenshot({ path: fileURLToPath(new URL('mobile.png', artifacts)), fullPage: true })
  assert.deepEqual(evidence.errors, [])
  console.log(JSON.stringify(evidence, null, 2))
} finally {
  await writeFile(new URL('browser.json', artifacts), JSON.stringify(evidence, null, 2))
  await browser.close()
  server?.kill('SIGTERM')
}
