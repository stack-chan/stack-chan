import assert from 'node:assert/strict'
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { updatePagesBundle } from './update-pages-bundle.mjs'

async function write(path, contents) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, contents)
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'stackchan-pages-bundle-'))
  const webDirectory = join(root, 'web-dist')
  const firmwareDirectory = join(root, 'firmware-bundle')
  const schemaFile = join(root, 'source/stackchan-mod.schema.json')
  const schematicsDirectory = join(root, 'candidate-schematics')
  const pagesRoot = join(root, 'pages')

  await write(join(webDirectory, 'index.html'), 'candidate web')
  await write(join(webDirectory, 'simulator/mc.js'), 'candidate simulator JavaScript')
  await write(join(webDirectory, 'simulator/mc.wasm'), 'candidate simulator WebAssembly')
  await write(join(webDirectory, 'flash/tech.moddable.stackchan/stale.bin'), 'stale web firmware')
  await write(join(webDirectory, 'schematics/index.html'), 'stale web schematics')
  await write(join(firmwareDirectory, 'm5stackchan_cores3/xs_esp32.bin'), 'candidate firmware')
  await write(schemaFile, '{"candidate":true}')
  await write(join(schematicsDirectory, 'index.html'), 'candidate schematics')

  return {
    root,
    webDirectory,
    firmwareDirectory,
    schemaFile,
    schematicsDirectory,
    pagesRoot,
  }
}

test('updates the selected Pages channel with candidate artifacts', async (t) => {
  const paths = await fixture()
  t.after(() => rm(paths.root, { recursive: true, force: true }))
  const destination = join(paths.pagesRoot, 'develop/web')
  await write(join(destination, 'obsolete.txt'), 'obsolete')
  await write(join(destination, 'schematics/index.html'), 'baseline schematics')

  const result = await updatePagesBundle({
    ...paths,
    pagesDirectory: 'develop/web',
  })

  assert.equal(result.targetDirectory, destination)
  assert.equal(await readFile(join(destination, 'index.html'), 'utf8'), 'candidate web')
  assert.equal(
    await readFile(join(destination, 'flash/tech.moddable.stackchan/m5stackchan_cores3/xs_esp32.bin'), 'utf8'),
    'candidate firmware'
  )
  assert.equal(await readFile(join(destination, 'schemas/stackchan-mod.schema.json'), 'utf8'), '{"candidate":true}')
  assert.equal(await readFile(join(destination, 'schematics/index.html'), 'utf8'), 'candidate schematics')
  await assert.rejects(access(join(destination, 'obsolete.txt')), {
    code: 'ENOENT',
  })
  await assert.rejects(access(join(destination, 'flash/tech.moddable.stackchan/stale.bin')), { code: 'ENOENT' })
})

test('preserves separately deployed schematics when no candidate artifact is supplied', async (t) => {
  const paths = await fixture()
  t.after(() => rm(paths.root, { recursive: true, force: true }))
  const destination = join(paths.pagesRoot, 'web')
  await write(join(destination, 'schematics/index.html'), 'published schematics')

  await updatePagesBundle({
    webDirectory: paths.webDirectory,
    firmwareDirectory: paths.firmwareDirectory,
    schemaFile: paths.schemaFile,
    pagesRoot: paths.pagesRoot,
    pagesDirectory: 'web',
  })

  assert.equal(await readFile(join(destination, 'schematics/index.html'), 'utf8'), 'published schematics')
  assert.equal(await readFile(join(destination, 'schemas/stackchan-mod.schema.json'), 'utf8'), '{"candidate":true}')
})

test('rejects a Pages destination outside the selected root', async (t) => {
  const paths = await fixture()
  t.after(() => rm(paths.root, { recursive: true, force: true }))

  await assert.rejects(
    updatePagesBundle({
      webDirectory: paths.webDirectory,
      firmwareDirectory: paths.firmwareDirectory,
      schemaFile: paths.schemaFile,
      pagesRoot: paths.pagesRoot,
      pagesDirectory: '../outside',
    }),
    /escapes the Pages root/
  )
})
