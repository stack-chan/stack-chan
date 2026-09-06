import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { resolveChromium, startPreview } from './test-preview-server.mjs'

const native = process.env.STACKCHAN_WEBMCP_NATIVE === '1'
const { baseUrl, server } = await startPreview({ port: 8096, url: process.env.STACKCHAN_WEBMCP_TEST_URL })
let browser
try {
  browser = await chromium.launch({
    executablePath: resolveChromium(),
    headless: true,
    args: [
      '--no-sandbox',
      ...(native ? ['--enable-experimental-web-platform-features', '--enable-blink-features=WebMCP'] : []),
    ],
  })
  const context = await browser.newContext()
  // Test-only adapter. Production exposes no globals or fallback implementation.
  await context.addInitScript(
    ({ native }) => {
      localStorage.setItem('stackchan.locale', 'ja')
      const registry = new Map()
      const nativeContext = document.modelContext
      if (native && !nativeContext?.registerTool)
        throw new Error('Native document.modelContext.registerTool is unavailable')
      if (native) {
        window.webmcpTest = {
          names: async () => (await nativeContext.getTools()).map((tool) => tool.name),
          execute: async (name, input) => {
            const tool = (await nativeContext.getTools()).find((tool) => tool.name === name)
            const result = await nativeContext.executeTool(tool, JSON.stringify(input))
            return typeof result === 'string' ? JSON.parse(result) : result
          },
        }
      } else {
        Object.defineProperty(document, 'modelContext', {
          configurable: true,
          value: {
            registerTool(tool, { signal }) {
              if (registry.has(tool.name)) throw new Error('Duplicate registration: ' + tool.name)
              registry.set(tool.name, tool)
              signal.addEventListener('abort', () => registry.delete(tool.name), { once: true })
            },
          },
        })
        window.webmcpTest = {
          names: () => [...registry.keys()],
          execute: (name, input) => registry.get(name).execute(input),
        }
      }
    },
    { native }
  )
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const call = async (name, input = {}) => {
    const result = await page
      .evaluate(({ name, input }) => window.webmcpTest.execute(name, input), { name, input })
      .catch((error) => {
        if (
          (name === 'stackchan.app.navigate' || name === 'stackchan.face.use_in_project') &&
          error.message.includes('Execution context was destroyed')
        )
          return null
        throw error
      })
    if (result === null && (name === 'stackchan.app.navigate' || name === 'stackchan.face.use_in_project')) return null
    assert.equal(result.ok, true, JSON.stringify(result))
    return result.data
  }
  const eventually = async (check, timeout = 30000) => {
    const deadline = Date.now() + timeout
    while (!(await check())) {
      if (Date.now() >= deadline) throw new Error('Timed out waiting for browser state')
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  const ready = (name) =>
    eventually(() => page.evaluate(async (name) => (await window.webmcpTest?.names())?.includes(name), name))
  const operation = async (id) => {
    let result
    const deadline = Date.now() + 90000
    do {
      result = await call('stackchan.app.get_operation', { operationId: id })
      if (['succeeded', 'failed', 'cancelled'].includes(result.status)) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    } while (Date.now() < deadline)
    assert.equal(result.status, 'succeeded', JSON.stringify(result))
    return result
  }
  await page.goto(`${baseUrl}/editor/`)
  await ready('stackchan.editor.request_remove_mod')
  await eventually(() =>
    page.evaluate(async () => (await window.webmcpTest.execute('stackchan.editor.get_project', {})).ok)
  )
  let project = await call('stackchan.editor.get_project')
  assert.ok((await call('stackchan.editor.get_catalog')).blocks.length > 20)
  project = await call('stackchan.editor.create_project', {
    expectedRevision: project.revision,
    name: 'WebMCP browser test',
    target: 'simulator',
  })
  project = await call('stackchan.editor.edit_blocks', {
    expectedRevision: project.revision,
    commands: [
      { op: 'create', id: 'start', type: 'stackchan_on_start' },
      { op: 'create', id: 'smile', type: 'stackchan_set_emotion', fields: { EMOTION: 'HAPPY' } },
      { op: 'connect', id: 'smile', parentId: 'start', input: 'DO' },
    ],
  })
  assert.ok(project.source.includes('Emotion.HAPPY'))
  assert.ok((await page.locator('.blocklyText').allTextContents()).length > 0)
  const stale = await page.evaluate(() =>
    window.webmcpTest.execute('stackchan.editor.edit_blocks', {
      expectedRevision: 'old-revision',
      commands: [{ op: 'delete', id: 'start' }],
    })
  )
  assert.equal(stale.error.code, 'revision_conflict')
  const build = await call('stackchan.editor.build', { expectedRevision: project.revision })
  await operation(build.id)
  project = await call('stackchan.editor.get_project')
  assert.equal(project.archiveReady, true)
  const run = await call('stackchan.editor.run_simulator', { expectedRevision: project.revision })
  await operation(run.id)
  assert.equal((await call('stackchan.editor.get_project')).simulator.status, 'running')
  await call('stackchan.editor.press_button', { button: 'a' })
  await page.screenshot({ path: '/tmp/stackchan-webmcp-simulator.png' })
  await call('stackchan.editor.stop_simulator')
  assert.equal((await call('stackchan.editor.get_project')).simulator.status, 'stopped')
  await call('stackchan.app.navigate', { page: 'face-editor' })
  await page.waitForURL('**/face-editor/')
  await ready('stackchan.face.use_in_project')
  let face = await call('stackchan.face.get')
  face = await call('stackchan.face.update', {
    expectedRevision: face.revision,
    changes: { name: 'WebMCP face', emotion: 'HAPPY', colors: { primary: '#123456' } },
  })
  assert.equal(face.asset.name, 'WebMCP face')
  assert.equal(JSON.parse((await call('stackchan.face.export')).json).colors.primary, '#123456')
  await call('stackchan.face.use_in_project', { expectedRevision: face.revision })
  await page.waitForURL(/\/editor\/(?:\?face-asset=staging)?$/)
  await ready('stackchan.editor.request_remove_mod')
  await eventually(() =>
    page.evaluate(async () => {
      const result = await window.webmcpTest.execute('stackchan.editor.get_project', {})
      return result.ok && result.data.project.assets.length > 0
    })
  )
  project = await call('stackchan.editor.get_project')
  assert.equal(project.project.name, 'WebMCP browser test')
  assert.ok(project.project.assets.some((asset) => asset.data.includes('WebMCP face')))
  await call('stackchan.app.navigate', { page: 'preference' })
  await page.waitForURL('**/preference/')
  await ready('stackchan.preferences.request_clear_wifi')
  assert.equal((await call('stackchan.preferences.get')).connected, false)
  const connect = await call('stackchan.preferences.request_connect')
  assert.equal(connect.status, 'waiting_user')
  await call('stackchan.app.cancel_operation', { operationId: connect.id })
  await call('stackchan.app.navigate', { page: 'guide' })
  await page.waitForURL('**/guide/')
  await ready('stackchan.app.cancel_operation')
  const guides = await call('stackchan.app.get_guide')
  assert.ok(guides.some((guide) => guide.id === 'files'))
  assert.ok(guides.find((guide) => guide.id === 'editor').href.startsWith(baseUrl))
  assert.deepEqual(errors, [])
  console.log(
    `WebMCP browser workflow passed (${native ? 'native discovery and execution' : 'test adapter'}): block edits, build, WASM execution, face transfer, preferences, guide.`
  )
} finally {
  await browser?.close()
  server?.kill('SIGTERM')
}
