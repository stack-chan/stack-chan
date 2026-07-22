import assert from 'node:assert/strict'
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { validatePagesPreview } from './validate-pages-preview.mjs'

const requiredFiles = [
  'index.html',
  'flash/tech.moddable.stackchan/m5stackchan_cores3/bootloader.bin',
  'flash/tech.moddable.stackchan/m5stackchan_cores3/partition-table.bin',
  'flash/tech.moddable.stackchan/m5stackchan_cores3/xs_esp32.bin',
  'simulator/index.html',
  'simulator/mc.js',
  'simulator/mc.wasm',
  'schemas/stackchan-mod.schema.json',
  'schematics/index.html',
]

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

test('rejects symbolic links', async () => {
  const root = await fixture()
  await symlink('index.html', join(root, 'linked-index.html'))
  await assert.rejects(validatePagesPreview(root), /Symbolic links are not allowed/)
})
