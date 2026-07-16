import assert from 'node:assert/strict'
import { test } from 'node:test'

import { assembleModSource } from './blocks.mjs'
import {
  buildModArchive,
  buildDirectoryName,
  DEFAULT_MOD_MANIFEST,
  detectToolsVersionMismatch,
  findFileWithSuffix,
  isXsArchive,
  manifestForProjectAssets,
  xsArchiveVersion,
} from './mod-builder.mjs'
import createTools from './vendor/tools.js'
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
    modJs: `export async function onContextCreated(robot) {\n  trace('hello from test\\n')\n}\n`,
    name: 'testmod',
    onLog: (line) => logs.push(line),
  })
  assert.ok(archive instanceof Uint8Array)
  assert.ok(archive.length > 100, `archive too small: ${archive.length}`)
  assert.ok(isXsArchive(archive), 'archive must start with XS_A atom')
  const version = xsArchiveVersion(archive)
  assert.deepEqual(version, profileFor('m5stackchan-cores3').xsArchiveVersion)
  const text = logs.join('\n')
  assert.match(text, /mcrun/, 'log should include the mcrun invocation')
  assert.match(text, /xsa/, 'log should include the xsa archive step')
})

test('buildModArchive compiles generator-style output with host-module imports', async () => {
  const source = `import Timer from 'timer'
import { randomBetween, wait } from 'stackchan-util'
import { Emotion } from 'face-state'

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export async function onContextCreated(robot) {
  ;(async () => {
    robot.face.setEmotion(Emotion.HAPPY)
    robot.face.setColor('primary', ...hexToRgb('#30e0ff'))
    robot.ui.showBalloon(String('こんにちは'))
  })().catch((error) => trace('start handler failed: ' + error + '\\n'))
  if (robot.input.button?.a) {
    robot.input.button.a.onEvent = (event) => {
      if (!event.pressed) return
      void (async () => {
        await robot.audio.say(String('やあ'))
        await wait(randomBetween(100, 200))
      })().catch((error) => trace('button a handler failed: ' + error + '\\n'))
    }
  }
  Timer.repeat(() => {
    robot.motion.lookAt([1, 0.5, 0])
  }, 10000)
}
`
  const archive = await buildModArchive(createTools, { modJs: source, name: 'generated' })
  assert.ok(isXsArchive(archive))
})

test('buildModArchive compiles a MOD using the new event/motion/ui blocks', async () => {
  // assembleModSource injects the event dispatch helpers + imports; this checks
  // the generated source for the new blocks actually compiles on the device.
  const body =
    "onButton(robot, 'a', 'release', (event) => {\n  void (async () => {\n    robot.face.setEmotion(Emotion.HAPPY)\n  })().catch((error) => trace('button a handler failed: ' + error + '\\n'))\n})\n" +
    "onImu(robot, 'shake', (event) => {\n  void (async () => {\n    await robot.audio.say(String('わっ'))\n  })().catch((error) => trace('imu handler failed: ' + error + '\\n'))\n})\n" +
    "onTouchPanel(robot, 'forwardSwipe', (event) => {\n  void (async () => {\n    robot.ui.toggleDrawer()\n  })().catch((error) => trace('touch handler failed: ' + error + '\\n'))\n})\n" +
    "robot.ui.drawer?.addDrawerButton({ key: 'k', label: 'ボタン', callback: () => {\n  void (async () => {\n    robot.ui.showFace()\n  })().catch((error) => trace('drawer handler failed: ' + error + '\\n'))\n} })\n" +
    'await robot.motion.setPose({ rotation: { p: (30 * Math.PI) / 180, y: (-45 * Math.PI) / 180, r: (0 * Math.PI) / 180 } }, 0.5)\n' +
    "robot.lighting.lightBlink('a', ...hexToRgb('#ff4040'), 250)\n"
  const source = assembleModSource(body)
  const archive = await buildModArchive(createTools, { modJs: source, name: 'newblocks' })
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
    modJs: 'export function onContextCreated() {}',
    name: 'assets',
    manifest: manifestForProjectAssets(assets),
    files: [{ path: assets[0].path, bytes: new TextEncoder().encode('hello') }],
  })
  assert.equal(isXsArchive(archive), true)
})

test('buildModArchive compiles a generated Shape Face implementation', async () => {
  const source = applyFaceAssetToSource(
    assembleModSource("robot.ui.showBalloon(String('Shape face ready'))\n"),
    createFaceAsset({
      name: '左右非対称フェイス',
      emotion: 'HAPPY',
      primary: '#30e0ff',
      secondary: '#301020',
      mouth: 0.65,
      shape: {
        eyes: {
          left: { x: 42, y: 35, radius: 11, eyelidWidth: 30, eyelidHeight: 26 },
          right: { x: 164, y: 42, radius: 6, eyelidWidth: 21, eyelidHeight: 18 },
        },
        mouth: { x: 106, y: 91, minWidth: 28, maxWidth: 110, minHeight: 5, maxHeight: 48 },
      },
    })
  )
  assert.match(source, /robot\.ui\.setFace/)
  const archive = await buildModArchive(createTools, { modJs: source, name: 'shape-face' })
  assert.equal(isXsArchive(archive), true)
})

test('manifestForProjectAssets omits resources when project embedding is disabled', () => {
  assert.equal(manifestForProjectAssets([]), DEFAULT_MOD_MANIFEST)
})

test('buildModArchive rejects project files that escape the project directory', async () => {
  await assert.rejects(
    buildModArchive(createTools, {
      modJs: 'export function onContextCreated() {}',
      files: [{ path: '../secret', bytes: new Uint8Array([1]) }],
    }),
    /invalid project file path/
  )
})

test('buildModArchive accepts dots within a safe asset filename', async () => {
  const archive = await buildModArchive(createTools, {
    modJs: 'export function onContextCreated() {}',
    files: [{ path: 'assets/face..draft.txt', bytes: new TextEncoder().encode('safe') }],
  })
  assert.equal(isXsArchive(archive), true)
})

test('generated manifest and source take precedence over colliding embedded files', async () => {
  const archive = await buildModArchive(createTools, {
    modJs: 'export function onContextCreated() {}',
    files: [
      { path: 'manifest.json', bytes: new TextEncoder().encode('{ invalid json') },
      { path: 'mod.js', bytes: new TextEncoder().encode('export function {{{ broken') },
    ],
  })
  assert.equal(isXsArchive(archive), true)
})
