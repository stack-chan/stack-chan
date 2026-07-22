import assert from 'node:assert/strict'
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { REQUIRED_FILES as requiredFiles, validatePagesPreview } from './validate-pages-preview.mjs'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'stackchan-pages-preview-'))
  for (const file of requiredFiles) {
    const path = join(root, file)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, 'test')
  }
  return root
}

test('accepts a complete static preview', async () => {
  const root = await fixture()
  assert.deepEqual(await validatePagesPreview(root), {
    fileCount: requiredFiles.length,
  })
})

test('rejects a missing generated artifact', async () => {
  const root = await fixture()
  await writeFile(join(root, 'simulator/mc.wasm'), '')
  await assert.rejects(validatePagesPreview(root), /empty or invalid: simulator\/mc\.wasm/)
})

test('rejects Cloudflare runtime code', async () => {
  const root = await fixture()
  await writeFile(join(root, '_worker.js'), 'export default {}')
  await assert.rejects(validatePagesPreview(root), /Cloudflare runtime controls are not allowed/)
})

test('rejects Cloudflare asset controls', async () => {
  const root = await fixture()
  await writeFile(join(root, '.assetsignore'), 'simulator/mc.wasm')
  await assert.rejects(validatePagesPreview(root), /Cloudflare runtime controls are not allowed/)
})

test('rejects Cloudflare header and redirect controls', async () => {
  for (const file of ['_headers', '_redirects']) {
    const root = await fixture()
    await writeFile(join(root, file), '/* https://example.com/:splat 302')
    await assert.rejects(validatePagesPreview(root), /Cloudflare runtime controls are not allowed/)
  }
})

test('rejects a top-level functions directory', async () => {
  const root = await fixture()
  await mkdir(join(root, 'functions'), { recursive: true })
  await writeFile(join(root, 'functions/index.js'), 'export default {}')
  await assert.rejects(validatePagesPreview(root), /Cloudflare Pages Functions are not allowed/)
})

test('rejects symbolic links', async () => {
  const root = await fixture()
  await symlink('index.html', join(root, 'linked-index.html'))
  await assert.rejects(validatePagesPreview(root), /Symbolic links are not allowed/)
})
