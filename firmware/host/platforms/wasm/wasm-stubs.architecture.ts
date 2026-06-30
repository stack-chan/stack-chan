import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { test } from 'node:test'

const SOURCE_EXTENSIONS = new Set(['.js', '.ts'])
const IMPORT_SPECIFIER = /(?:from\s+|import\(\s*)['"]([^'"]+)['"]/g

function listSourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) return listSourceFiles(path)
    return SOURCE_EXTENSIONS.has(path.slice(path.lastIndexOf('.'))) ? [path] : []
  })
}

function importSpecifiers(source: string): string[] {
  return [...source.matchAll(IMPORT_SPECIFIER)].map((match) => match[1])
}

function isWasmImport(specifier: string): boolean {
  return specifier.includes('/wasm/') || specifier.includes('/wasm-') || specifier === 'wasm-driver'
}

function isWasmSource(path: string): boolean {
  return (
    path.startsWith('host/platforms/wasm/') ||
    path.startsWith('host/app/default-behavior/wasm/') ||
    path.includes('/wasm/')
  )
}

function isTestSource(path: string): boolean {
  return path.endsWith('.test.ts') || path.includes('/__tests__/')
}

function readManifest(path: string) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

test('WASM-only imports stay under wasm platform and wasm implementation files', () => {
  const offenders = listSourceFiles('host')
    .map((path) => relative('.', path))
    .filter((path) => !isWasmSource(path) && !isTestSource(path))
    .flatMap((path) =>
      importSpecifiers(readFileSync(path, 'utf8'))
        .filter(isWasmImport)
        .map((specifier) => `${path}: ${specifier}`),
    )

  assert.deepEqual(offenders, [])
})

test('WASM manifest keeps concrete servo driver module specifiers as facades for Moddable resolution', () => {
  const manifest = readManifest('host/platforms/wasm/manifest.json')

  assert.ok(manifest.include.includes('../../modules/audio/manifest_wasm.json'))
  assert.ok(manifest.include.includes('../../modules/camera/manifest_wasm.json'))
  assert.ok(manifest.include.includes('../../modules/motion/manifest_wasm.json'))
  assert.ok(manifest.preload.includes('wasm-camera-bridge'))
  assert.ok(manifest.include.includes('../../modules/input/manifest.json'))
  assert.ok(manifest.preload.includes('touch-panel'))
  assert.ok(manifest.preload.includes('touch-panel-gesture'))
  assert.deepEqual(
    {
      'py32-led': manifest.modules['py32-led'],
    },
    {
      'py32-led': '../../modules/lighting/wasm/py32-led',
    },
  )
})

test('WASM audio manifest owns audio bridge, microphone, tone, and TTS stubs', () => {
  const manifest = readManifest('host/modules/audio/manifest_wasm.json')

  assert.deepEqual(
    {
      'audio-buffer': manifest.modules['audio-buffer'],
      'wasm-audio-bridge': manifest.modules['wasm-audio-bridge'],
      tone: manifest.modules.tone,
      microphone: manifest.modules.microphone,
      'embedded:io/audio/in': manifest.modules['embedded:io/audio/in'],
      'tts-types': manifest.modules['tts-types'],
      'tts-local': manifest.modules['tts-local'],
      'tts-remote': manifest.modules['tts-remote'],
      'tts-voicevox': manifest.modules['tts-voicevox'],
      'tts-voicevox-web': manifest.modules['tts-voicevox-web'],
      'tts-elevenlabs': manifest.modules['tts-elevenlabs'],
      'tts-openai': manifest.modules['tts-openai'],
    },
    {
      'audio-buffer': './audio-buffer',
      'wasm-audio-bridge': './wasm/audio-bridge',
      tone: './wasm/tone',
      microphone: './wasm/microphone',
      'embedded:io/audio/in': './wasm/audio-in',
      'tts-types': './tts-types',
      'tts-local': './wasm/tts-local',
      'tts-remote': './wasm/tts-remote',
      'tts-voicevox': './wasm/tts-voicevox',
      'tts-voicevox-web': './wasm/tts-voicevox-web',
      'tts-elevenlabs': './wasm/tts-elevenlabs',
      'tts-openai': './wasm/tts-openai',
    },
  )
  assert.ok(manifest.preload.includes('wasm-audio-bridge'))
})

test('WASM servo driver manifest keeps facade module specifiers', () => {
  const manifest = readManifest('host/modules/motion/manifest_wasm.json')

  assert.deepEqual(
    {
      'dynamixel-driver': manifest.modules['dynamixel-driver'],
      'm5stackchan-servo-driver': manifest.modules['m5stackchan-servo-driver'],
      'none-driver': manifest.modules['none-driver'],
      'sg90-driver': manifest.modules['sg90-driver'],
      'rs30x-driver': manifest.modules['rs30x-driver'],
      'scservo-driver': manifest.modules['scservo-driver'],
    },
    {
      'dynamixel-driver': './wasm/dynamixel-driver',
      'm5stackchan-servo-driver': './wasm/m5stackchan-servo-driver',
      'none-driver': './wasm/none-driver',
      'sg90-driver': './wasm/sg90-driver',
      'rs30x-driver': './wasm/rs30x-driver',
      'scservo-driver': './wasm/scservo-driver',
    },
  )
})

test('WASM manifest selects the wasm app default behavior without an app-layer runtime branch', () => {
  const appManifest = readManifest('host/app/manifest_wasm.json')
  const manifest = readManifest('host/platforms/wasm/manifest.json')

  assert.ok(appManifest.include.includes('../platforms/wasm/manifest.json'))
  assert.equal(manifest.modules['app-default-behavior'], '../../app/default-behavior/wasm/behavior')
  assert.equal(manifest.modules['app-default-behavior/wasm/behavior'], '../../app/default-behavior/wasm/behavior')
  assert.equal(
    manifest.modules['app-default-behavior/on-context-created'],
    '../../app/default-behavior/on-context-created',
  )
  assert.equal(manifest.modules['app-default-behavior/*'], undefined)
  assert.ok(manifest.preload.includes('app-default-behavior'))
})

test('real-device camera preview manifest resolves the shared UI preview module', () => {
  const manifest = readManifest('host/app/manifest.json')

  assert.equal(manifest.modules['camera-preview'], '../modules/ui/views/camera-preview/camera-preview-view')
  assert.equal(manifest.modules['camera-preview-utils'], '../modules/ui/views/camera-preview/camera-preview-utils')
})

test('WASM camera preview manifest resolves the native RuntimeBitmapPort binding', () => {
  const manifest = readManifest('host/modules/camera/manifest_wasm.json')

  assert.equal(manifest.modules['camera-preview'], './wasm/camera-preview')
  assert.equal(manifest.modules['runtime-bitmap-port'], './wasm/runtime-bitmap-port')
})

test('WASM servo driver facade files re-export the consolidated WasmDriver through a manifest module specifier', () => {
  const facadePaths = [
    'host/modules/motion/wasm/dynamixel-driver.ts',
    'host/modules/motion/wasm/m5stackchan-servo-driver.ts',
    'host/modules/motion/wasm/none-driver.ts',
    'host/modules/motion/wasm/sg90-driver.ts',
    'host/modules/motion/wasm/rs30x-driver.ts',
    'host/modules/motion/wasm/scservo-driver.ts',
  ]

  for (const facadePath of facadePaths) {
    const source = readFileSync(facadePath, 'utf8')
    assert.match(source, /from 'wasm-driver'/)
    assert.doesNotMatch(source, /\.\//)
  }
})

test('WASM PY32 LED facade re-exports the shared LED stub through a manifest module specifier', () => {
  const source = readFileSync('host/modules/lighting/wasm/py32-led.ts', 'utf8')

  assert.match(source, /from 'led'/)
  assert.doesNotMatch(source, /\.\//)
})

test('App main lets an installed MOD replace the product default behavior', () => {
  const mainSource = readFileSync('host/app/main.ts', 'utf8')
  const behaviorSource = readFileSync('host/app/app-behavior-resolver.ts', 'utf8')

  assert.match(mainSource, /import defaultBehavior from 'app-default-behavior'/)
  assert.match(mainSource, /resolveAppBehaviors\(Modules, defaultBehavior\)/)
  assert.match(mainSource, /runLaunchBehaviors\(appBehaviors\)/)
  assert.match(mainSource, /loadPreferenceConfig\(\)/)
  assert.match(mainSource, /createStackchanContext\(preferences\)/)
  assert.match(mainSource, /runContextCreatedBehaviors\(appBehaviors, context, \{/)
  assert.match(mainSource, /device: getHostDeviceEnvironment\(\)/)
  assert.match(mainSource, /config: preferences/)
  assert.match(behaviorSource, /modules\.has\('mod'\)/)
  assert.match(behaviorSource, /modules\.importNow\('mod'\)/)
  assert.match(behaviorSource, /return \[modules\.importNow\('mod'\)\]/)
  assert.match(behaviorSource, /return \[defaultBehavior\]/)
  assert.doesNotMatch(behaviorSource, /behaviors\.push\(/)
  assert.doesNotMatch(mainSource, /config\.wasm/)
  assert.doesNotMatch(mainSource, /default-mods\/wasm\/mod/)
  assert.doesNotMatch(mainSource, /onRobotCreated/)
  assert.doesNotMatch(mainSource, /defaultMod/)
})

test('real-device camera preview stays independent from the WASM-only RuntimeBitmapPort binding', () => {
  const previewSource = readFileSync('host/modules/ui/views/camera-preview/camera-preview-view.ts', 'utf8')

  assert.doesNotMatch(previewSource, /runtime-bitmap-port/)
  assert.doesNotMatch(previewSource, /RuntimeBitmapPort/)
  assert.match(previewSource, /new Port\(/)
  assert.match(previewSource, /onRender\?: \(mode: CameraPreviewRenderMode\) => void/)
  assert.match(previewSource, /this\.options\?\.onRender\?\.\('mosaic'\)/)
})

test('WASM camera preview uses a native RuntimeBitmapPort binding before falling back to mosaic', () => {
  const previewSource = readFileSync('host/modules/camera/wasm/camera-preview.ts', 'utf8')
  const portSource = readFileSync('host/modules/camera/wasm/runtime-bitmap-port.js', 'utf8')

  assert.match(portSource, /drawBitmap\(bitmap, x, y, sx = 0, sy = 0, sw = bitmap\.width, sh = bitmap\.height\)/)
  assert.match(portSource, /xs_stackchan_runtime_bitmap_port_draw/)
  assert.match(previewSource, /import RuntimeBitmapPort from 'runtime-bitmap-port'/)
  assert.match(previewSource, /from 'camera-preview-utils'/)
  assert.doesNotMatch(previewSource, /^import (?!type).*from '\.\.\//m)
  assert.match(previewSource, /new RuntimeBitmapPort\(/)
  assert.match(previewSource, /reportRenderMode\('runtime-bitmap-port'\)/)
  assert.doesNotMatch(previewSource, /ENABLE_RUNTIME_TEXTURE_PREVIEW/)
  assert.doesNotMatch(previewSource, /drawRgb565Texture/)
})

test('WASM camera preview can be dismissed by touch or an automatic timeout', () => {
  const previewSource = readFileSync('host/modules/ui/views/camera-preview/camera-preview-view.ts', 'utf8')
  const modSource = readFileSync('host/app/default-behavior/on-context-created.ts', 'utf8')

  assert.match(previewSource, /onDismiss\?: \(\) => void/)
  assert.match(previewSource, /active: true/)
  assert.match(previewSource, /onTouchEnded\(_port: PiuPort\)/)
  assert.match(previewSource, /this\.options\?\.onDismiss\?\.\(\)/)
  assert.match(modSource, /CAMERA_PREVIEW_DURATION_MS = 5000/)
  assert.match(modSource, /onDismiss: restoreCameraPreview/)
  assert.match(modSource, /distribute\?\.\('onDrawerClose'\)/)
  assert.match(modSource, /closeDrawer\(\)/)
  assert.match(modSource, /Timer\.set\(restoreCameraPreview, CAMERA_PREVIEW_DURATION_MS\)/)
  assert.doesNotMatch(modSource, /robot\.camera\.stop\(\)/)
})
