import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'
import { resolveChromium, startPreview } from '../test-preview-server.mjs'

// Official Chrome flags entry maps enable-webmcp-testing to blink::features::kWebMCP:
// https://github.com/chromium/chromium/blob/main/chrome/browser/about_flags.cc
// This flag affects only the disposable browser launched by this test.
const flag = '--enable-features=WebMCP'
const { baseUrl, server } = await startPreview({ port: 8217, url: process.env.STACKCHAN_AVATAR_NATIVE_TEST_URL })
const artifacts = new URL('./artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
const evidence = {
  kind: 'native Chromium WebMCP; no modelContext mock',
  flag,
  sources: [
    'https://developer.chrome.com/docs/ai/webmcp',
    'https://developer.chrome.com/docs/ai/webmcp/imperative-api',
    'https://github.com/chromium/chromium/blob/main/chrome/browser/about_flags.cc',
    'https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/script_tools/model_context.idl',
  ],
  checks: [],
  failures: [],
}
let browser
try {
  browser = await chromium.launch({ executablePath: resolveChromium(), headless: true, args: ['--no-sandbox', flag] })
  evidence.browser = browser.version()
  const context = await browser.newContext()
  // Only USB is mocked. The browser's native WebMCP objects are untouched.
  await context.addInitScript(() => {
    window.__nativeWebMCPUSBMock = { chooserCalls: 0, enumerationCalls: 0 }
    Object.defineProperty(navigator, 'serial', {
      configurable: false,
      value: Object.freeze({
        requestPort() {
          window.__nativeWebMCPUSBMock.chooserCalls++
          return Promise.reject(new DOMException('Native WebMCP test USB mock; no hardware', 'NotFoundError'))
        },
        getPorts() {
          window.__nativeWebMCPUSBMock.enumerationCalls++
          return Promise.resolve([])
        },
      }),
    })
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${baseUrl}/avatar-dsl/`)
  await page.waitForFunction(() => !document.getElementById('transfer').disabled, undefined, { timeout: 30000 })
  evidence.api = await page.evaluate(() => ({
    secureContext: isSecureContext,
    documentRegisterTool: typeof document.modelContext?.registerTool,
    documentGetTools: typeof document.modelContext?.getTools,
    documentExecuteTool: typeof document.modelContext?.executeTool,
    navigatorRegisterTool: typeof navigator.modelContext?.registerTool,
    navigatorTesting: typeof navigator.modelContextTesting,
    documentTesting: typeof document.modelContextTesting,
    registerImplementation: document.modelContext?.registerTool?.toString(),
    bridgeStatus: document.getElementById('bridge-status').textContent,
  }))
  if (
    evidence.api.documentRegisterTool !== 'function' ||
    evidence.api.documentGetTools !== 'function' ||
    evidence.api.documentExecuteTool !== 'function'
  ) {
    evidence.supported = false
    evidence.blocker =
      'Installed Chromium does not expose the current document.modelContext register/get/execute API under the official local-testing feature flag.'
  } else {
    evidence.supported = true
    assert.match(evidence.api.registerImplementation, /\[native code\]/)
    assert.equal(evidence.api.bridgeStatus, 'WebMCP tools available')
    const registered = await page.evaluate(async () =>
      (await document.modelContext.getTools()).map(({ window: _window, ...tool }) => tool)
    )
    assert.equal(registered.length, 6)
    evidence.registered = registered
    evidence.checks.push(
      'six editor tools registered in the real browser modelContext and discovered through native getTools'
    )

    const nativeCall = (name, input = {}, argumentMode = 'object') =>
      page.evaluate(
        async ({ name, input, argumentMode }) => {
          const tool = (await document.modelContext.getTools()).find((tool) => tool.name === `stackchan_face_${name}`)
          if (!tool) throw new Error(`Tool unavailable: ${name}`)
          const raw = await document.modelContext.executeTool(
            tool,
            argumentMode === 'json-string' ? JSON.stringify(input) : input
          )
          if (typeof raw !== 'string') return raw
          try {
            return JSON.parse(raw)
          } catch {
            return raw
          }
        },
        { name, input, argumentMode }
      )
    let argumentMode = 'object'
    let guide
    try {
      guide = await nativeCall('guide')
    } catch (error) {
      evidence.objectArgumentsError = error.message
      argumentMode = 'json-string'
      guide = await nativeCall('guide', {}, argumentMode)
    }
    evidence.executeArgumentMode = argumentMode
    const call = (name, input) => nativeCall(name, input, argumentMode)
    assert.match(guide.guide, /begin_group/)
    const snapshot = await call('read')
    const sampleNames = await call('samples')
    for (const name of ['default', 'aokko', 'omega', 'minimal', 'rounded', 'compound', 'Mono eye'])
      assert.ok(sampleNames.names.includes(name))
    assert.equal(sampleNames.names.length, 7)
    assert.equal(sampleNames.names.includes('mono'), false)
    const monoEye = await call('samples', { name: 'Mono eye' })
    assert.equal(monoEye.name, 'Mono eye')
    const uiNames = await page.locator('#sample option').evaluateAll((options) => options.map((option) => option.value))
    assert.deepEqual(uiNames.sort(), sampleNames.names.sort())
    assert.ok(guide.guide.includes('Mono eye'))
    const sample = await call('samples', { name: 'rounded' })
    await call('replace', { source: sample.source, expectedRevision: snapshot.revision })
    await page.waitForFunction(() => !document.getElementById('transfer').disabled)
    assert.equal(await page.locator('#source').inputValue(), sample.source)
    const replaced = await call('read')
    await assert.rejects(call('replace', { source: sample.source, expectedRevision: snapshot.revision }), (error) => {
      // Native Chromium surfaces tool exceptions as UnknownError rather than
      // forwarding the application's exact error message. Check state too.
      evidence.staleRevisionBrowserError = error.message
      return true
    })
    assert.deepEqual(await call('read'), replaced)
    await call('undo')
    assert.equal(await page.locator('#source').inputValue(), snapshot.source)
    await page.waitForFunction(() => !document.getElementById('transfer').disabled)
    evidence.checks.push(
      'native executeTool invokes guide/sample/read, editor replace, stale-revision refusal, and undo'
    )

    const current = await call('read')
    const staged = await call('request_transfer', { expectedRevision: current.revision })
    assert.equal(staged.status, 'awaiting_user_confirmation')
    assert.equal(await page.locator('#confirmation').evaluate((dialog) => dialog.open), true)
    assert.deepEqual(await page.evaluate(() => window.__nativeWebMCPUSBMock), { chooserCalls: 0, enumerationCalls: 0 })
    await page.locator('#cancel-transfer').click()
    assert.equal(await page.locator('#confirmation').evaluate((dialog) => dialog.open), false)
    assert.deepEqual(await page.evaluate(() => window.__nativeWebMCPUSBMock), { chooserCalls: 0, enumerationCalls: 0 })
    evidence.checks.push(
      'native agent transfer tool builds the real MOD, stages visible confirmation, and cancellation performs zero USB operations'
    )
    for (const source of [
      'fn draw(',
      'fn f(a) end fn draw() f() end',
      'fn f(a) end fn draw() f(1,2) end',
      'fn f() end fn draw() let x=f() end',
      'fn draw() let x=fill_rect(0,0,1,1,primary) end',
    ]) {
      const invalidRevision = (await call('read')).revision
      await call('replace', { source, expectedRevision: invalidRevision })
      const invalid = await call('read')
      await assert.rejects(call('request_transfer', { expectedRevision: invalid.revision }))
      assert.equal(await page.locator('#confirmation').evaluate((dialog) => dialog.open), false)
      assert.deepEqual(await page.evaluate(() => window.__nativeWebMCPUSBMock), {
        chooserCalls: 0,
        enumerationCalls: 0,
      })
      await call('undo')
      await page.waitForFunction(() => !document.getElementById('transfer').disabled)
    }
    evidence.checks.push(
      'syntax, incorrect user-function arity, void helper and void builtin values block agent transfer before confirmation or USB; undo recovers'
    )
    assert.deepEqual(errors, [])
    evidence.checks.push('no uncaught browser errors')
  }
  evidence.usb = await page.evaluate(() => window.__nativeWebMCPUSBMock)
  evidence.chatGPTAppTested = false
  evidence.physicalDeviceAccess = false
} catch (error) {
  evidence.failures.push(error.stack)
  throw error
} finally {
  await writeFile(new URL('./webmcp-native.json', artifacts), `${JSON.stringify(evidence, null, 2)}\n`)
  await browser?.close()
  server?.kill('SIGTERM')
}
console.log(JSON.stringify(evidence, null, 2))
