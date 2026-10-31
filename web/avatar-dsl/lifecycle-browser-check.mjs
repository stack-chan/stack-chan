import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'
import { resolveChromium, startPreview } from '../test-preview-server.mjs'

const { baseUrl, server } = await startPreview({ port: 8219, url: process.env.STACKCHAN_AVATAR_LIFECYCLE_TEST_URL })
const artifacts = new URL('./artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
const evidence = { scenarios: [], errors: [], physicalDeviceAccess: false }
const ready = (page) => page.waitForFunction(() => !document.getElementById('transfer').disabled)
const revision = async (page) => Number((await page.locator('#revision').textContent()).match(/\d+/)[0])
const canvas = (page) => page.locator('#preview').evaluate((element) => element.toDataURL())

async function instrument(context) {
  await context.addInitScript(() => {
    window.lifecycleEvidence = { documentId: crypto.randomUUID(), events: [], workers: new Set(), started: 0, usb: 0 }
    Object.defineProperty(navigator, 'serial', {
      configurable: false,
      value: Object.freeze({
        requestPort() {
          lifecycleEvidence.usb++
          throw new Error('Lifecycle test blocks physical device access')
        },
        getPorts() {
          lifecycleEvidence.usb++
          return Promise.resolve([])
        },
      }),
    })
    const NativeWorker = Worker
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args)
        lifecycleEvidence.started++
        lifecycleEvidence.workers.add(this)
      }
      terminate() {
        lifecycleEvidence.workers.delete(this)
        return super.terminate()
      }
    }
    for (const name of ['pagehide', 'pageshow'])
      addEventListener(name, (event) => {
        lifecycleEvidence.events.push({ name, persisted: event.persisted, trusted: event.isTrusted })
      })
  })
}

async function callTool(page, name, input = {}, argumentMode = 'object') {
  return page.evaluate(
    async ({ name, input, argumentMode }) => {
      const tool = (await document.modelContext.getTools()).find((entry) => entry.name === `stackchan_face_${name}`)
      if (!tool) throw new Error(`Tool unavailable: ${name}`)
      const result = await document.modelContext.executeTool(
        tool,
        argumentMode === 'object' ? input : JSON.stringify(input)
      )
      return typeof result === 'string' ? JSON.parse(result) : result
    },
    { name, input, argumentMode }
  )
}

let browser
try {
  for (const webmcp of [false, true]) {
    // Playwright normally disables bfcache. Use full Chromium (not headless
    // shell), remove that switch, and require a trusted persisted pageshow.
    browser = await chromium.launch({
      executablePath: resolveChromium(),
      headless: true,
      ignoreDefaultArgs: ['--disable-back-forward-cache'],
      args: ['--no-sandbox', `--${webmcp ? 'enable' : 'disable'}-features=WebMCP`],
    })
    const scenario = { browser: browser.version(), webmcp, actualBackRestores: [], syntheticTransitions: [] }
    evidence.scenarios.push(scenario)
    let context = await browser.newContext({ acceptDownloads: true })
    context.setDefaultTimeout(30000)
    await instrument(context)
    let page = await context.newPage()
    page.on('pageerror', (error) => evidence.errors.push(error.message))
    const cdp = await context.newCDPSession(page)
    await cdp.send('Page.enable')
    cdp.on('Page.backForwardCacheNotUsed', (event) => {
      scenario.notRestored = event.notRestoredExplanations
    })
    await page.goto(`${baseUrl}/avatar-dsl/`)
    await ready(page)
    let argumentMode = 'object'
    if (webmcp) {
      try {
        await callTool(page, 'guide')
      } catch {
        argumentMode = 'json-string'
        await callTool(page, 'guide', {}, argumentMode)
      }
    } else {
      assert.match(await page.locator('#bridge-status').textContent(), /unavailable/)
    }
    const call = (name, input) => callTool(page, name, input, argumentMode)
    const assertTools = async (count) => {
      if (webmcp) assert.equal(await page.evaluate(async () => (await document.modelContext.getTools()).length), count)
    }
    await assertTools(6)
    await page.locator('#sample').selectOption('Mono eye')
    await ready(page)
    const source = `${await page.locator('#source').inputValue()}\n-- retained user draft\n`
    await page.locator('#source').fill(source)
    await page.locator('#eye').evaluate((element) => {
      element.value = '0.5'
      element.dispatchEvent(new Event('input'))
    })
    await ready(page)
    const retainedCanvas = await canvas(page)
    const documentId = await page.evaluate(() => lifecycleEvidence.documentId)

    async function backFromAnotherPage(valid = true) {
      const oldRevision = await revision(page)
      const oldDraft = await page.locator('#source').inputValue()
      const starts = await page.evaluate(() => lifecycleEvidence.started)
      await page.goto(`${baseUrl}/`)
      await page.goBack({ waitUntil: 'commit' })
      await page.waitForFunction(() =>
        lifecycleEvidence.events.some((event) => event.name === 'pageshow' && event.persisted && event.trusted)
      )
      assert.equal(
        await page.evaluate(() => lifecycleEvidence.documentId),
        documentId,
        'Back must restore the same Document'
      )
      const transitions = await page.evaluate(() => lifecycleEvidence.events.slice(-2))
      assert.deepEqual(transitions, [
        { name: 'pagehide', persisted: true, trusted: true },
        { name: 'pageshow', persisted: true, trusted: true },
      ])
      assert.equal(await page.locator('#source').inputValue(), oldDraft)
      assert.equal(await revision(page), oldRevision)
      assert.equal(await page.locator('#eye').inputValue(), '0.5')
      assert.equal(await page.locator('#sample').inputValue(), 'Mono eye')
      assert.equal(await page.locator('#confirmation').evaluate((dialog) => dialog.open), false)
      assert.equal(await page.locator('#compatible-host').isChecked(), false)
      assert.equal(await page.locator('#confirm-transfer').isDisabled(), true)
      await assertTools(6)
      if (valid) {
        await ready(page)
        assert.ok(
          (await page.evaluate(() => lifecycleEvidence.started)) > starts,
          'restoration recompiles retained context'
        )
        assert.equal(await canvas(page), retainedCanvas)
      } else {
        assert.equal(await page.locator('#transfer').isDisabled(), true)
        assert.equal(
          await page.evaluate(() => lifecycleEvidence.started),
          starts,
          'oversized draft must not compile the old model'
        )
      }
      scenario.actualBackRestores.push({ documentId, revision: oldRevision, valid, transitions })
    }

    for (let cycle = 0; cycle < 3; cycle++) {
      await page.locator('#transfer').click()
      await page.waitForFunction(() => document.getElementById('confirmation').open)
      await backFromAnotherPage()
      const before = await revision(page)
      const nextSource = `${source}\n-- edit after Back ${cycle}\n`
      if (webmcp) {
        assert.deepEqual(await call('read'), { source, revision: before })
        await call('replace', { source: nextSource, expectedRevision: before })
      } else await page.locator('#source').fill(nextSource)
      assert.equal(await revision(page), before + 1, 'one edit must have one listener')
      await ready(page)
      await page.locator('#undo').click()
      assert.equal(await page.locator('#source').inputValue(), source)
      assert.equal(await revision(page), before + 2, 'one undo must restore one history entry')
      await ready(page)
      const pendingDownload = page.waitForEvent('download')
      await page.locator('#download').click()
      const chunks = []
      for await (const chunk of await (await pendingDownload).createReadStream()) chunks.push(chunk)
      assert.equal(Buffer.concat(chunks).toString('utf8'), source)
    }

    const oversized = 'x'.repeat(32769)
    await page.locator('#source').fill(oversized)
    assert.match(await page.locator('#diagnostic').textContent(), /32 KiB/)
    await backFromAnotherPage(false)
    assert.equal(await page.locator('#source').inputValue(), oversized)
    assert.match(await page.locator('#diagnostic').textContent(), /32 KiB/)
    await page.locator('#source').fill(source)
    await ready(page)

    // Synthetic transitions exercise cancellation deterministically, separately
    // from the trusted browser-managed Back restorations above.
    await page.locator('#source').fill(`${source}\n-- queued edit\n`)
    const starts = await page.evaluate(() => {
      dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
      return lifecycleEvidence.started
    })
    await page.waitForTimeout(350)
    assert.equal(await page.evaluate(() => lifecycleEvidence.started), starts, 'hide cancels debounced compilation')
    await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })))
    await ready(page)
    await page.evaluate(() => {
      document.getElementById('validate').click()
      queueMicrotask(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })))
    })
    assert.equal(await page.evaluate(() => lifecycleEvidence.workers.size), 0, 'hide terminates active preview workers')
    assert.equal(await page.locator('#transfer').isDisabled(), true)
    await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })))
    await ready(page)
    await assertTools(6)
    scenario.syntheticTransitions.push('debounce cancellation', 'active preview termination', 'persisted resume')

    await page.locator('#transfer').click()
    await page.waitForFunction(() => document.getElementById('confirmation').open)
    const disposedRevision = await revision(page)
    await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })))
    await assertTools(0)
    assert.equal(await page.locator('#confirmation').evaluate((dialog) => dialog.open), false)
    await page.locator('#source').fill(`${source}\n-- disposed editor\n`)
    assert.equal(await revision(page), disposedRevision)
    await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })))
    await assertTools(0)
    assert.equal(await page.evaluate(() => lifecycleEvidence.workers.size), 0)
    scenario.syntheticTransitions.push('non-persisted cleanup unregisters tools and cannot resume')

    // A separate browser with Playwright's default bfcache-disabled switch
    // exercises a real non-persisted departure, rather than simulating one.
    await context.close()
    await browser.close()
    browser = await chromium.launch({
      executablePath: resolveChromium(),
      headless: true,
      args: ['--no-sandbox', `--${webmcp ? 'enable' : 'disable'}-features=WebMCP`],
    })
    context = await browser.newContext()
    context.setDefaultTimeout(30000)
    await instrument(context)
    page = await context.newPage()
    page.on('pageerror', (error) => evidence.errors.push(error.message))
    await page.goto(`${baseUrl}/avatar-dsl/`)
    await ready(page)
    await page.locator('#transfer').click()
    await page.waitForFunction(() => document.getElementById('confirmation').open)
    await page.evaluate(() => {
      addEventListener(
        'pagehide',
        (event) => {
          const before = document.getElementById('revision').textContent
          document.getElementById('source').value += '\n-- departed\n'
          document.getElementById('source').dispatchEvent(new Event('input'))
          const cleanup = {
            persisted: event.persisted,
            trusted: event.isTrusted,
            workers: lifecycleEvidence.workers.size,
            confirmation: document.getElementById('confirmation').open,
            acknowledgement: document.getElementById('compatible-host').checked,
            listenersDisposed: before === document.getElementById('revision').textContent,
            usb: lifecycleEvidence.usb,
          }
          sessionStorage.setItem('avatar-lifecycle-cleanup', JSON.stringify(cleanup))
        },
        { once: true }
      )
    })
    await page.goto(`${baseUrl}/`)
    scenario.actualDeparture = await page.evaluate(() => JSON.parse(sessionStorage.getItem('avatar-lifecycle-cleanup')))
    assert.deepEqual(scenario.actualDeparture, {
      persisted: false,
      trusted: true,
      workers: 0,
      confirmation: false,
      acknowledgement: false,
      listenersDisposed: true,
      usb: 0,
    })
    await context.close()
    await browser.close()
    browser = undefined
  }
  assert.deepEqual(evidence.errors, [])
  console.log(JSON.stringify(evidence, null, 2))
} catch (error) {
  evidence.failure = error.message
  throw error
} finally {
  await writeFile(new URL('lifecycle.json', artifacts), JSON.stringify(evidence, null, 2))
  await browser?.close()
  server?.kill('SIGTERM')
}
