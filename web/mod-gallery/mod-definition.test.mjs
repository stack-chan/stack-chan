import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { isXsArchive, xsArchiveVersion } from '../editor/mod-builder.mjs'
import { profileFor } from '../editor/capabilities.mjs'
import { parseVisualProject } from '../editor/project-format.mjs'
import { analyzeWorkspace } from '../editor/project-validator.mjs'
import { loadModCatalog, parseModDefinition, validatePackagePath } from './mod-definition.mjs'

const catalogUrl = new URL('./catalog.json', import.meta.url)

async function fileFetch(url) {
  try {
    const text = readFileSync(url, 'utf8')
    return { ok: true, status: 200, json: async () => JSON.parse(text) }
  } catch {
    return { ok: false, status: 404 }
  }
}

test('共通MOD定義からテキストとブロックのGalleryを構成する', async () => {
  const definitions = await loadModCatalog(catalogUrl, fileFetch)
  assert.equal(definitions.length, 10)
  assert.equal(definitions.filter((definition) => definition.type === 'text').length, 6)
  assert.equal(definitions.filter((definition) => definition.type === 'block').length, 4)
  assert.equal(definitions.filter((definition) => definition.entrypoints.includes('miniapp')).length, 2)
  assert.equal(new Set(definitions.map((definition) => definition.id)).size, definitions.length)

  for (const definition of definitions) {
    assert.equal(definition.sourceUrl.protocol, 'file:')
    assert.doesNotThrow(() => readFileSync(definition.sourceUrl))
    assert.doesNotThrow(() => readFileSync(definition.sourceViewUrl))
    if (definition.type !== 'block') continue
    const project = parseVisualProject(readFileSync(definition.sourceUrl, 'utf8'))
    const analysis = analyzeWorkspace(project.workspace, { target: project.target })
    assert.equal(analysis.canBuild, true, `${definition.id}: ${JSON.stringify(analysis.diagnostics)}`)
    assert.deepEqual(analysis.diagnostics, [], `${definition.id}: 初期状態に診断を残さない`)
    assert.deepEqual(analysis.requirements, [...definition.capabilities].sort())
  }
})

test('テキストMODの成果物は既存の実行互換性を維持する', async () => {
  const definitions = await loadModCatalog(catalogUrl, fileFetch)
  const textMods = definitions.filter((definition) => definition.type === 'text')
  assert.equal(textMods.length, 6)
  for (const definition of textMods) {
    assert.equal(definition.artifacts.length, 1, `${definition.id}: installable text MOD should include one artifact`)
    const archive = readFileSync(definition.artifacts[0].url)
    assert.equal(isXsArchive(archive), true, `${definition.id}: artifact should be an XS archive`)
    assert.deepEqual(
      xsArchiveVersion(archive),
      profileFor('m5stackchan-cores3').xsArchiveVersion,
      `${definition.id}: artifact should match the host XS`
    )
    assert.equal(
      archive.includes(Buffer.from('/tmp/')),
      false,
      `${definition.id}: artifact should not expose build paths`
    )
    assert.equal(
      archive.includes(Buffer.from('/home/')),
      false,
      `${definition.id}: artifact should not expose build paths`
    )
  }
})

test('MediaPipe GalleryパッケージはFirmwareサンプルと同じ実行ソースを公開する', () => {
  const firmware = new URL('../../firmware/mods/examples/mediapipe_ble/', import.meta.url)
  const gallery = new URL('./samples/mediapipe-ble/mod/', import.meta.url)
  for (const filename of ['manifest.json', 'mod.js', 'tracking-message.js', 'tracking-receiver.js']) {
    assert.equal(
      readFileSync(new URL(filename, gallery), 'utf8'),
      readFileSync(new URL(filename, firmware), 'utf8'),
      `${filename} should not drift between the firmware example and gallery package`
    )
  }
})

test('MCP GalleryパッケージはFirmwareサンプルと同じ実行ソースを公開する', () => {
  const firmware = new URL('../../firmware/mods/examples/mcp/', import.meta.url)
  const gallery = new URL('./samples/mcp/mod/', import.meta.url)
  for (const filename of ['manifest.json', 'mod.js']) {
    assert.equal(
      readFileSync(new URL(filename, gallery), 'utf8'),
      readFileSync(new URL(filename, firmware), 'utf8'),
      `${filename} should not drift between the firmware example and gallery package`
    )
  }
})

test('Codex Voice GalleryパッケージはFirmwareサンプルと同じ実行ソースを公開する', () => {
  const firmware = new URL('../../firmware/mods/examples/codex_voice/', import.meta.url)
  const gallery = new URL('./samples/codex-voice/mod/', import.meta.url)
  for (const filename of ['manifest.json', 'mod.js']) {
    assert.equal(
      readFileSync(new URL(filename, gallery), 'utf8'),
      readFileSync(new URL(filename, firmware), 'utf8'),
      `${filename} should not drift between the firmware example and gallery package`
    )
  }
})

test('Stack-chanミニゲーム集GalleryパッケージはFirmwareサンプルと同じ実行ソースを公開する', () => {
  const firmware = new URL('../../firmware/mods/examples/stackchan_minigames/', import.meta.url)
  const gallery = new URL('./samples/stackchan-minigames/miniapp/', import.meta.url)
  for (const filename of [
    'manifest.json',
    'miniapp.ts',
    'README.md',
    'README_ja.md',
    'LICENSE.mouse-follower',
    'assets/stack-chan.png',
    'assets/player-left.png',
    'assets/player-center.png',
    'assets/player-right.png',
    'assets/screw.png',
    'assets/m5stack.png',
    'assets/bubble.png',
    'assets/bomb.png',
    'assets/miss.png',
  ]) {
    assert.deepEqual(
      readFileSync(new URL(filename, gallery)),
      readFileSync(new URL(filename, firmware)),
      `${filename} should not drift between the firmware example and gallery package`
    )
  }
})

test('UI Playground GalleryパッケージはFirmwareサンプルと同じ実行ソースを公開する', () => {
  const firmware = new URL('../../firmware/mods/examples/mini_app_ui_sample/', import.meta.url)
  const gallery = new URL('./samples/ui-playground/miniapp/', import.meta.url)
  for (const filename of ['manifest.json', 'miniapp.ts']) {
    assert.equal(
      readFileSync(new URL(filename, gallery), 'utf8'),
      readFileSync(new URL(filename, firmware), 'utf8'),
      `${filename} should not drift between the firmware example and gallery package`
    )
  }
})

test('MOD定義は形式別の正本と安全なパッケージパスを要求する', () => {
  const base = {
    format: 'tech.stackchan.mod',
    schemaVersion: 1,
    id: 'tech.stackchan.test.sample',
    version: '1.0.0',
    name: 'test',
    description: 'test MOD',
    targets: ['simulator'],
  }
  assert.throws(() => parseModDefinition({ ...base, type: 'block', source: { path: 'manifest.json' } }), /block MOD/)
  assert.throws(
    () => parseModDefinition({ ...base, type: 'text', source: { path: 'sample.stackchan-blocks.json' } }),
    /text MOD/
  )
  assert.deepEqual(parseModDefinition({ ...base, type: 'text', source: { path: 'manifest.json' } }).entrypoints, [
    'mod',
  ])
  assert.deepEqual(
    parseModDefinition({
      ...base,
      type: 'text',
      source: { path: 'manifest.json' },
      entrypoints: ['mod', 'miniapp'],
    }).entrypoints,
    ['mod', 'miniapp']
  )
  for (const entrypoints of [null, [], ['miniapp', 'miniapp'], ['unknown']]) {
    assert.throws(
      () => parseModDefinition({ ...base, type: 'text', source: { path: 'manifest.json' }, entrypoints }),
      /entrypoints/
    )
  }
  assert.throws(
    () =>
      parseModDefinition({
        ...base,
        type: 'block',
        source: { path: 'sample.stackchan-blocks.json', entrypoint: 'mod.js' },
      }),
    /source.entrypoint/
  )
  assert.throws(
    () =>
      parseModDefinition({
        ...base,
        type: 'text',
        source: { path: 'manifest.json', entrypoint: 'README.md' },
      }),
    /JavaScriptまたはTypeScript/
  )
  assert.deepEqual(
    parseModDefinition({
      ...base,
      type: 'text',
      source: { path: 'manifest.json' },
      setup: { url: 'https://example.test/setup' },
    }).setup,
    { url: 'https://example.test/setup' }
  )
  for (const url of ['/setup', 'http://example.test/setup', 'javascript:alert(1)']) {
    assert.throws(
      () =>
        parseModDefinition({
          ...base,
          type: 'text',
          source: { path: 'manifest.json' },
          setup: { url },
        }),
      /setup\.url/
    )
  }
  for (const path of [
    '/manifest.json',
    './mod.js',
    '../manifest.json',
    'mod//mod.js',
    'mod/../manifest.json',
    'mod\\manifest.json',
  ]) {
    assert.throws(() => validatePackagePath(path), /安全な相対パス/)
  }
})

test('テキストMODはビルド用manifestとは別に閲覧用entrypointを公開できる', async () => {
  const definitions = await loadModCatalog(catalogUrl, fileFetch)
  const starter = definitions.find((definition) => definition.id === 'tech.stackchan.samples.starter')

  assert.equal(starter.sourceUrl.pathname.endsWith('/sample-mod/manifest.json'), true)
  assert.equal(starter.sourceViewUrl.pathname.endsWith('/sample-mod/mod.js'), true)
})

test('entrypointを省略したMODはビルド用ソースを閲覧用にも使う', async () => {
  const definitions = await loadModCatalog(catalogUrl, fileFetch)
  const blockMod = definitions.find((definition) => definition.type === 'block')

  assert.equal(blockMod.source.entrypoint, undefined)
  assert.equal(blockMod.sourceViewUrl.href, blockMod.sourceUrl.href)
})

test('セットアップ手順を持つMODは絶対HTTPS URLを公開する', async () => {
  const definitions = await loadModCatalog(catalogUrl, fileFetch)
  const codexVoice = definitions.find((definition) => definition.id === 'tech.stackchan.samples.codex-voice')

  assert.equal(
    codexVoice.setupUrl?.href,
    'https://github.com/meganetaaan/stack-chan-dock/tree/develop/apps/codex-voice'
  )
})

test('JSON Schemaと実装が同じ形式識別子と必須フィールドを持つ', () => {
  const schema = JSON.parse(
    readFileSync(new URL('../../docs/specs/stackchan-mod.schema.json', import.meta.url), 'utf8')
  )
  assert.equal(schema.properties.format.const, 'tech.stackchan.mod')
  assert.equal(schema.properties.schemaVersion.const, 1)
  assert.equal(schema.$id, 'https://stack-chan.github.io/stack-chan/web/schemas/stackchan-mod.schema.json')
  for (const field of [
    'format',
    'schemaVersion',
    'id',
    'version',
    'type',
    'name',
    'description',
    'source',
    'targets',
  ]) {
    assert.ok(schema.required.includes(field), `${field} must be required`)
  }
  const relativePath = new RegExp(schema.$defs.relativePath.pattern)
  for (const validPath of ['mod.js', 'mod/mod.js']) {
    assert.equal(relativePath.test(validPath), true, `${validPath} must be accepted by the schema`)
  }
  for (const invalidPath of ['./mod.js', 'mod//mod.js']) {
    assert.equal(relativePath.test(invalidPath), false, `${invalidPath} must be rejected by the schema`)
    assert.throws(() => validatePackagePath(invalidPath), /安全な相対パス/)
  }
  assert.equal(new RegExp(schema.properties.setup.properties.url.pattern).test('https://example.test/setup'), true)
  assert.equal(new RegExp(schema.properties.setup.properties.url.pattern).test('http://example.test/setup'), false)
})
