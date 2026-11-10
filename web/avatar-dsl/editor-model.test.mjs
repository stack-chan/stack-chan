import test from 'node:test'
import assert from 'node:assert/strict'
import { createEditorModel, checkSource, createPreviewService } from './editor-model.mjs'
import { createTools, registerWebMCP } from './webmcp.mjs'

test('bounded UTF-8 source, revision conflicts and reversible edits', () => {
  assert.throws(() => checkSource('あ'.repeat(11000)), /32 KiB/)
  const model = createEditorModel('first')
  model.replace('agent change', 0)
  assert.throws(() => model.replace('stale overwrite', 0), /changed/)
  assert.equal(model.source, 'agent change')
  assert.equal(model.undo(), true)
  assert.equal(model.source, 'first')
  assert.equal(model.revision, 2)
})
test('runaway worker terminates and the next preview recovers', async () => {
  const workers = []
  const service = createPreviewService(() => {
    const worker = {
      postMessage() {},
      terminate() {
        this.terminated = true
      },
    }
    workers.push(worker)
    return worker
  }, 10)
  await assert.rejects(service.run('slow', []), /timed out/)
  assert.equal(workers[0].terminated, true)
  const pending = service.run('valid', [])
  workers[1].onmessage({ data: { bytecode: new ArrayBuffer(16), result: {} } })
  assert.equal((await pending).bytecode.byteLength, 16)
  assert.equal(workers[1].terminated, true)
})
test('new preview cancels old work; a stale worker cannot replace it', async () => {
  const workers = []
  const service = createPreviewService(() => {
    const worker = { postMessage() {}, terminate() {} }
    workers.push(worker)
    return worker
  })
  const first = service.run('first', []).catch((error) => error.message)
  const second = service.run('second', [])
  workers[0].onmessage({ data: { value: 'stale' } })
  workers[1].onmessage({ data: { value: 'current' } })
  assert.equal(await first, 'Preview cancelled')
  assert.equal((await second).value, 'current')
})
test('WebMCP reuses editor validation, revision guard, undo and transfer staging', async () => {
  const model = createEditorModel('initial')
  let updates = 0,
    staged = 0
  const tools = createTools({
    model,
    guide: 'guide',
    samples: { minimal: 'sample' },
    changed: () => updates++,
    requestTransfer: async () => {
      staged++
      return { status: 'awaiting_user_confirmation' }
    },
  })
  const call = (name, input) => tools.find((tool) => tool.name === `stackchan_face_${name}`).execute(input)
  assert.deepEqual(await call('read'), { source: 'initial', revision: 0 })
  await assert.rejects(call('replace', { source: 'x', expectedRevision: 2 }), /changed/)
  await assert.rejects(call('replace', { source: 'x' }), /required/)
  await call('replace', { source: 'new', expectedRevision: 0 })
  assert.equal(updates, 1)
  await call('undo')
  assert.equal(model.source, 'initial')
  await assert.rejects(call('request_transfer', { expectedRevision: 0 }), /changed/)
  assert.equal((await call('request_transfer', { expectedRevision: 2 })).status, 'awaiting_user_confirmation')
  assert.equal(staged, 1)
  await assert.rejects(call('samples', { name: '__proto__' }), /Unknown/)
})
test('WebMCP feature detection preserves fallback and cleans registered tools', async () => {
  assert.equal((await registerWebMCP([], { document: {} })).supported, false)
  const registrations = []
  const api = {
    async registerTool(tool, options) {
      registrations.push({ tool, options })
    },
  }
  const result = await registerWebMCP([{ name: 'example' }], { document: { modelContext: api }, window: undefined })
  assert.equal(result.supported, true)
  result.dispose()
  assert.equal(registrations[0].options.signal.aborted, true)
  const self = {},
    top = {}
  assert.equal((await registerWebMCP([], { document: { modelContext: api }, window: { self, top } })).supported, false)
})

test('editor lifecycle abort removes WebMCP registration and a fresh mount can register', async () => {
  const active = new Set()
  const api = {
    async registerTool(tool, { signal }) {
      if (signal.aborted) throw signal.reason
      assert.equal(active.has(tool.name), false)
      active.add(tool.name)
      signal.addEventListener('abort', () => active.delete(tool.name), { once: true })
    },
  }
  const options = { document: { modelContext: api }, window: undefined }
  const lifecycle = new AbortController()
  const first = await registerWebMCP([{ name: 'face' }], { ...options, signal: lifecycle.signal })
  assert.equal(first.supported, true)
  lifecycle.abort()
  assert.equal(active.size, 0)
  const next = await registerWebMCP([{ name: 'face' }], options)
  assert.equal(next.supported, true)
  next.dispose()
  assert.equal(active.size, 0)
})
