import assert from 'node:assert/strict'
import { test } from 'node:test'

import { assembleModSource } from './blocks.mjs'
import {
  buildModArchive as buildPackageArchive,
  buildDirectoryName,
  DEFAULT_MOD_MANIFEST,
  detectToolsVersionMismatch,
  findFileWithSuffix,
  isXsArchive,
  manifestForProjectAssets,
  xsArchiveVersion,
} from './mod-builder.mjs'
import createTools from './vendor/tools.js'
import { modDefinition } from '../../firmware/contracts/testing/xsa-fixture.js'
import { inspectModArchive } from '../../firmware/contracts/xsa-metadata.js'
const buildModArchive = (tools, options) =>
  buildPackageArchive(tools, { metadata: { ...modDefinition, appApiVersion: 2, hostApiVersion: 8 }, ...options })
import { profileFor } from './capabilities.mjs'
import { applyFaceAssetToSource, createFaceAsset } from './face-assets.mjs'

test('detectToolsVersionMismatch parses the TOOL warning', () => {
  const logs = [
    '### -p wasm',
    'Moddable SDK tools mismatch between binary (8.3.1) and source (9.0.0)! Rebuilding tools.',
  ]
  assert.equal(detectToolsVersionMismatch(logs), '8.3.1')
  assert.equal(detectToolsVersionMismatch(['no mismatch here']), null)
})

test('findFileWithSuffix picks the first match', () => {
  const paths = ['/a/b.txt', '/a/mc.xsa', '/a/other.xsa']
  assert.equal(findFileWithSuffix(paths, '.xsa'), '/a/mc.xsa')
  assert.equal(findFileWithSuffix(paths, '.bin'), undefined)
})

test('project display names cannot escape the virtual build directory', () => {
  assert.equal(buildDirectoryName('../秘密/../../etc'), 'etc')
  assert.equal(buildDirectoryName('顔のMOD'), 'MOD')
  assert.equal(buildDirectoryName('hello-world_2'), 'hello-world_2')
})

test('isXsArchive rejects non-archives', () => {
  assert.equal(isXsArchive(new Uint8Array([0, 1, 2])), false)
  assert.equal(isXsArchive(new TextEncoder().encode('....XS_A....VERS')), true)
})

test('xsArchiveVersion requires the VERS atom', () => {
  // "....XS_A...." + "VERS" + version bytes
  const withVers = new TextEncoder().encode('....XS_A....VERS')
  const bytes = new Uint8Array(19)
  bytes.set(withVers.subarray(0, 16), 0)
  bytes[16] = 17
  bytes[17] = 8
  bytes[18] = 0
  assert.deepEqual(xsArchiveVersion(bytes), [17, 8, 0])
  // XS_A header but no VERS atom -> null instead of garbage version bytes
  const noVers = new TextEncoder().encode('....XS_A....XXXX...')
  assert.equal(xsArchiveVersion(noVers), null)
})

test('buildModArchive compiles a mod to a valid XS archive via wasm mcrun', async () => {
  const logs = []
  const archive = await buildModArchive(createTools, {
    modJs: assembleModSource("trace('hello from test\\n')"),
    name: 'testmod',
    onLog: (line) => logs.push(line),
  })
  assert.ok(archive instanceof Uint8Array)
  assert.ok(archive.length > 100, `archive too small: ${archive.length}`)
  assert.ok(isXsArchive(archive), 'archive must start with XS_A atom')
  const { metadata } = inspectModArchive(archive, (bytes) => new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  assert.equal(metadata.id, modDefinition.id)
  assert.equal(metadata.appApiVersion, 2)
  const version = xsArchiveVersion(archive)
  assert.deepEqual(version, profileFor('m5stackchan-cores3').xsArchiveVersion)
  const text = logs.join('\n')
  assert.match(text, /mcrun/, 'log should include the mcrun invocation')
  assert.match(text, /xsa/, 'log should include the xsa archive step')
})

test('new builds require an explicit API declaration and reject mismatched entrypoints', async () => {
  await assert.rejects(buildPackageArchive(createTools, { modJs: 'export default {}' }), /MOD定義/)
  await assert.rejects(
    buildModArchive(createTools, {
      modJs: 'export default {}',
      metadata: { ...modDefinition, appApiVersion: 1, entrypoints: ['miniapp'] },
    }),
    (error) => error.code === 'MOD_APP_API_UNSUPPORTED'
  )
  await assert.rejects(
    buildModArchive(createTools, {
      modJs: 'export default {}',
      files: [{ path: 'stackchan-mod.json', bytes: new Uint8Array() }],
    }),
    /supplied through metadata/
  )
  const archive = await buildPackageArchive(createTools, {
    modJs:
      'import { defineApp } from "stackchan/app"; export default defineApp({ setup(app) { app.face.setEmotion("happy") } })',
    metadata: modDefinition,
  })
  assert.equal(inspectModArchive(archive, (bytes) => new TextDecoder().decode(bytes)).metadata.appApiVersion, 2)
})

test('buildModArchive compiles generated SDK operations and score data', async () => {
  const source = assembleModSource(`
input(app).onRelease('primary', async (task) => { await task.sleep(50) })
input(app).onMotion(async (event, task) => { await app.audio.say(event.motion, { signal: task.signal }) })
input(app).onHeadTouch(async () => { ui(app).toggleMenu() }, { gesture: 'petting' })
ui(app).addAction({ id: 'face', label: 'Face' }, async () => { ui(app).showFace() })
await app.motion.move({ pitchDeg: 30, yawDeg: -45 }, { durationMs: 500, signal: task.signal })
lighting(app).blink('head', hexToRgb('#ff4040'), { periodMs: 250 })
await singing(app).sing(120, [['C4', 1, 'き'], ['R', 0.5, '']], { signal: task.signal })
`)
  const archive = await buildModArchive(createTools, { modJs: source, name: 'sdk-blocks' })
  assert.ok(isXsArchive(archive))
})

test('buildModArchive surfaces syntax errors from xsc', async () => {
  await assert.rejects(
    buildModArchive(createTools, { modJs: 'export function {{{ broken', name: 'brokenmod' }),
    (error) => {
      assert.match(String(error.message), /build step failed|mcrun failed/)
      return true
    }
  )
})

test('buildModArchive embeds project assets through the standard MOD resources manifest', async () => {
  const assets = [{ path: 'assets/faces/greeting.txt' }]
  const archive = await buildModArchive(createTools, {
    modJs: assembleModSource(''),
    name: 'assets',
    manifest: manifestForProjectAssets(assets),
    files: [{ path: assets[0].path, bytes: new TextEncoder().encode('hello') }],
  })
  assert.equal(isXsArchive(archive), true)
})

test('buildModArchive compiles a generated Shape Face implementation', async () => {
  const source = applyFaceAssetToSource(
    assembleModSource("app.ui.showBalloon(String('Shape face ready'))\n"),
    createFaceAsset({
      name: '左右非対称フェイス',
      emotion: 'HAPPY',
      primary: '#30e0ff',
      secondary: '#301020',
      mouth: 0.65,
      shape: {
        eyes: {
          left: {
            x: 42,
            y: 35,
            shape: 'roundRect',
            width: 30,
            height: 20,
            r: 6,
            eyelidWidth: 30,
            eyelidHeight: 20,
          },
          right: { x: 164, y: 42, radius: 6, eyelidWidth: 21, eyelidHeight: 18 },
        },
        mouth: { visible: false, x: 106, y: 91, minWidth: 28, maxWidth: 110, minHeight: 5, maxHeight: 48 },
      },
    })
  )
  assert.match(source, /ui\(app\)\.setShapeFace/)
  assert.match(source, /"shape": "roundRect"/)
  assert.doesNotMatch(source, /new Mouth/)
  const archive = await buildModArchive(createTools, { modJs: source, name: 'shape-face' })
  assert.equal(isXsArchive(archive), true)
})

test('manifestForProjectAssets omits resources when project embedding is disabled', () => {
  assert.equal(manifestForProjectAssets([]), DEFAULT_MOD_MANIFEST)
})

test('buildModArchive rejects project files that escape the project directory', async () => {
  await assert.rejects(
    buildModArchive(createTools, {
      modJs: assembleModSource(''),
      files: [{ path: '../secret', bytes: new Uint8Array([1]) }],
    }),
    /invalid project file path/
  )
})

test('buildModArchive accepts dots within a safe asset filename', async () => {
  const archive = await buildModArchive(createTools, {
    modJs: assembleModSource(''),
    files: [{ path: 'assets/face..draft.txt', bytes: new TextEncoder().encode('safe') }],
  })
  assert.equal(isXsArchive(archive), true)
})

test('generated manifest and source take precedence over colliding embedded files', async () => {
  const archive = await buildModArchive(createTools, {
    modJs: assembleModSource(''),
    files: [
      { path: 'manifest.json', bytes: new TextEncoder().encode('{ invalid json') },
      { path: 'mod.js', bytes: new TextEncoder().encode('export function {{{ broken') },
    ],
  })
  assert.equal(isXsArchive(archive), true)
})
