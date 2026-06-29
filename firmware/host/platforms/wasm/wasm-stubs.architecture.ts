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

test('App main registers product behavior and installed MOD behavior separately', () => {
  const source = readFileSync('host/app/main.ts', 'utf8')

  assert.match(source, /import defaultBehavior from 'app-default-behavior'/)
  assert.match(source, /Modules\.has\('mod'\)/)
  assert.match(source, /Modules\.importNow\('mod'\) as StackchanAppBehavior/)
  assert.match(source, /behaviors\.push\(behavior\)/)
  assert.match(source, /runLaunchBehaviors\(appBehaviors\)/)
  assert.match(source, /loadPreferenceConfig\(\)/)
  assert.match(source, /createStackchanContext\(preferences\)/)
  assert.match(source, /runContextCreatedBehaviors\(appBehaviors, context, \{/)
  assert.match(source, /device: getHostDeviceEnvironment\(\)/)
  assert.match(source, /config: preferences/)
  assert.doesNotMatch(source, /config\.wasm/)
  assert.doesNotMatch(source, /default-mods\/wasm\/mod/)
  assert.doesNotMatch(source, /onRobotCreated/)
  assert.doesNotMatch(source, /defaultMod/)
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
