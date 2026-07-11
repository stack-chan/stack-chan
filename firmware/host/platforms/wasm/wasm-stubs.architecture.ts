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
  assert.ok(manifest.include.includes('../../modules/preferences/manifest_wasm.json'))
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

test('WASM preferences use an in-memory Preference implementation', () => {
  const platformManifest = readManifest('host/platforms/wasm/manifest.json')
  const connectivityManifest = readManifest('host/modules/connectivity/manifest_wasm.json')
  const preferencesManifest = readManifest('host/modules/preferences/manifest_wasm.json')
  const preferenceSource = readFileSync('host/modules/preferences/wasm/preference.ts', 'utf8')

  assert.ok(platformManifest.include.includes('../../modules/preferences/manifest_wasm.json'))
  assert.ok(connectivityManifest.include.includes('../preferences/manifest_wasm.json'))
  assert.equal(preferencesManifest.modules.preference, './wasm/preference')
  assert.ok(!preferencesManifest.include.includes('$(MODULES)/files/preference/manifest.json'))
  assert.match(preferenceSource, /Object\.create\(null\)/)
  assert.match(preferenceSource, /get\(domain: string, key: string\): unknown/)
  assert.match(preferenceSource, /set\(domain: string, key: string, value: unknown\): void/)
  assert.match(preferenceSource, /export default Preference/)
})

test('WASM source imports omit TypeScript file extensions', () => {
  const offenders = listSourceFiles('host')
    .map((path) => relative('.', path))
    .filter((path) => isWasmSource(path) && !isTestSource(path))
    .flatMap((path) =>
      importSpecifiers(readFileSync(path, 'utf8'))
        .filter((specifier) => specifier.endsWith('.ts'))
        .map((specifier) => `${path}: ${specifier}`),
    )

  assert.deepEqual(offenders, [])
})

test('WASM audio manifest owns audio bridge, microphone, speaker, and TTS stubs', () => {
  const manifest = readManifest('host/modules/audio/manifest_wasm.json')
  const microphone = readFileSync('host/modules/audio/wasm/microphone.ts', 'utf8')
  const speaker = readFileSync('host/modules/audio/wasm/speaker.ts', 'utf8')
  const contract = readFileSync('host/modules/audio/wasm/audio-bridge-contract.ts', 'utf8')
  const nativeBridge = readFileSync('host/modules/audio/wasm/audio-bridge.js', 'utf8')
  const cameraBridge = readFileSync('host/modules/camera/wasm/camera-bridge.js', 'utf8')

  assert.deepEqual(
    {
      'audio-buffer': manifest.modules['audio-buffer'],
      'wasm-audio-bridge': manifest.modules['wasm-audio-bridge'],
      'wasm-audio-bridge-contract': manifest.modules['wasm-audio-bridge-contract'],
      speaker: manifest.modules.speaker,
      microphone: manifest.modules.microphone,
      'audio-in': manifest.modules['audio-in'],
      'tts-types': manifest.modules['tts-types'],
      'tts-local': manifest.modules['tts-local'],
      'tts-remote': manifest.modules['tts-remote'],
      'tts-voicevox': manifest.modules['tts-voicevox'],
      'tts-voicevox-web': manifest.modules['tts-voicevox-web'],
      'tts-elevenlabs': manifest.modules['tts-elevenlabs'],
      'tts-openai': manifest.modules['tts-openai'],
      'tts-stackchan-voice': manifest.modules['tts-stackchan-voice'],
    },
    {
      'audio-buffer': './audio-buffer',
      'wasm-audio-bridge': './wasm/audio-bridge',
      'wasm-audio-bridge-contract': './wasm/audio-bridge-contract',
      speaker: './wasm/speaker',
      microphone: './wasm/microphone',
      'audio-in': './wasm/audio-in',
      'tts-types': './tts-types',
      'tts-local': './wasm/tts-local',
      'tts-remote': './wasm/tts-remote',
      'tts-voicevox': './wasm/tts-voicevox',
      'tts-voicevox-web': './wasm/tts-voicevox-web',
      'tts-elevenlabs': './wasm/tts-elevenlabs',
      'tts-openai': './wasm/tts-openai',
      'tts-stackchan-voice': './wasm/tts-stackchan-voice',
    },
  )
  assert.ok(manifest.preload.includes('wasm-audio-bridge'))
  assert.match(contract, /export type WasmAudioBridge/)
  assert.match(contract, /WASM_AUDIO_BRIDGE_POLL_INTERVAL_MS = 50/)
  assert.match(microphone, /WASM_AUDIO_BRIDGE_POLL_INTERVAL_MS/)
  assert.match(speaker, /WASM_AUDIO_BRIDGE_POLL_INTERVAL_MS/)
  assert.match(microphone, /import type \{ WasmAudioInputBridge \} from '\.\/audio-bridge-contract\.js'/)
  assert.match(speaker, /import type \{ WasmAudioOutputBridge \} from '\.\/audio-bridge-contract\.js'/)
  assert.match(microphone, /const WASM_AUDIO_BRIDGE_POLL_INTERVAL_MS = 50/)
  assert.match(speaker, /const WASM_AUDIO_BRIDGE_POLL_INTERVAL_MS = 50/)
  assert.doesNotMatch(microphone, /^import (?!type).*audio-bridge-contract/m)
  assert.doesNotMatch(speaker, /^import (?!type).*audio-bridge-contract/m)
  assert.doesNotMatch(microphone, /schedule\(audioBridge, poll, 50\)/)
  assert.doesNotMatch(speaker, /schedule\(audioBridge, poll, 50\)/)
  assert.doesNotMatch(nativeBridge, /export default/)
  assert.doesNotMatch(cameraBridge, /export default/)
  assert.match(nativeBridge, /globalThis\.__stackchanWasmAudioBridge =/)
  assert.match(cameraBridge, /globalThis\.__stackchanWasmCameraBridge =/)
})

test('WASM camera owns the browser camera default option', () => {
  const cameraTypes = readFileSync('host/modules/camera/camera.ts', 'utf8')
  const wasmCamera = readFileSync('host/modules/camera/wasm/camera.ts', 'utf8')
  const deviceCamera = readFileSync('host/modules/camera/device/camera.ts', 'utf8')
  const defaultBehavior = readFileSync('host/app/default-behavior/on-context-created.ts', 'utf8')

  assert.doesNotMatch(cameraTypes, /useBrowserCamera/)
  assert.doesNotMatch(defaultBehavior, /useBrowserCamera/)
  assert.match(wasmCamera, /const DEFAULT_USE_BROWSER_CAMERA = true/)
  assert.match(wasmCamera, /export type WasmCameraConstructorOptions = \{/)
  assert.match(wasmCamera, /export type WasmCameraStartOptions = CameraCaptureOptions & \{/)
  assert.match(wasmCamera, /useBrowserCamera\?: boolean/)
  assert.match(wasmCamera, /resolveUseBrowserCamera\(options, this\.#useBrowserCamera\)/)
  assert.match(deviceCamera, /export type DeviceCameraConstructorOptions = Record<string, never>/)
  assert.doesNotMatch(deviceCamera, /WasmCameraConstructorOptions/)
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

test('WASM manifest keeps the shared app runtime module list in sync with the host app manifest', () => {
  const appManifest = readManifest('host/app/manifest.json')
  const wasmManifest = readManifest('host/platforms/wasm/manifest.json')
  const hostAppModules = appManifest.modules['*']
    .filter((specifier: string) => specifier.startsWith('./'))
    .map((specifier: string) => `../../app/${specifier.slice(2)}`)
  const wasmAppModules = wasmManifest.modules['*'].filter((specifier: string) => specifier.startsWith('../../app/'))

  assert.deepEqual(wasmAppModules, hostAppModules)
})

test('real-device camera preview manifest resolves the shared UI preview module', () => {
  const manifest = readManifest('host/app/manifest.json')

  // The generic/default alias (used by the Linux simulator) stays on the mosaic-only view so no
  // WASM-only native binding leaks into the Linux import graph.
  assert.equal(manifest.modules['camera-preview'], '../modules/ui/views/camera-preview/camera-preview-view')
  assert.equal(manifest.modules['camera-preview-utils'], '../modules/ui/views/camera-preview/camera-preview-utils')
})

test('device camera preview overrides the alias with the RuntimeBitmapPort bitmap variant', () => {
  // esp32 device builds include manifest_device.json, which overrides camera-preview with a
  // bitmap-capable module so the real camera image is drawn (mosaic remains the fallback).
  const deviceManifest = readManifest('host/modules/camera/manifest_device.json')
  assert.equal(deviceManifest.modules['camera-preview'], './device/camera-preview')

  const devicePreviewSource = readFileSync('host/modules/camera/device/camera-preview.ts', 'utf8')
  assert.match(devicePreviewSource, /import RuntimeBitmapPort from 'runtime-bitmap-port'/)
  assert.match(devicePreviewSource, /reportRenderMode\('bitmap'\)/)
  // Falls back to the mosaic path when bitmap drawing is unavailable.
  assert.match(devicePreviewSource, /reportRenderMode\('mosaic'\)/)
})

test('WASM camera preview manifest resolves the native RuntimeBitmapPort binding', () => {
  const manifest = readManifest('host/modules/camera/manifest_wasm.json')

  assert.equal(manifest.modules['camera-preview'], './wasm/camera-preview')
  assert.equal(manifest.modules['runtime-bitmap-port'], '../ui/views/camera-preview/runtime-bitmap-port')
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

test('App main lets an installed MOD override only the behavior hooks it defines', () => {
  const mainSource = readFileSync('host/app/main.ts', 'utf8')
  const behaviorSource = readFileSync('host/app/app-behavior-resolver.ts', 'utf8')

  assert.match(mainSource, /import defaultBehavior from 'app-default-behavior'/)
  assert.match(mainSource, /resolveAppBehaviors\(Modules, defaultBehavior\)/)
  assert.match(mainSource, /runLaunchBehaviors\(appBehaviors\)/)
  assert.match(mainSource, /loadPreferenceConfig\(\)/)
  assert.match(mainSource, /createStackchanContext\(preferences, \{ connectivity: bootServices\.connectivity \}\)/)
  assert.match(mainSource, /runContextCreatedBehaviors\(appBehaviors, context, \{/)
  assert.match(mainSource, /device: getHostDeviceEnvironment\(\)/)
  assert.match(mainSource, /config: preferences/)
  assert.match(behaviorSource, /modules\.has\('mod'\)/)
  assert.match(behaviorSource, /modules\.importNow\('mod'\)/)
  assert.match(
    behaviorSource,
    /mergeDefinedBehavior\(defaultBehavior, modules\.importNow\('mod'\) as Partial<TBehavior>\)/,
  )
  assert.match(behaviorSource, /if \(value !== undefined\)/)
  assert.match(behaviorSource, /return \[defaultBehavior\]/)
  assert.doesNotMatch(behaviorSource, /behaviors\.push\(/)
  assert.doesNotMatch(mainSource, /config\.wasm/)
  assert.doesNotMatch(mainSource, /default-mods\/wasm\/mod/)
  assert.doesNotMatch(mainSource, /onRobotCreated/)
  assert.doesNotMatch(mainSource, /defaultMod/)
})

test('default camera preview avoids WASM-only RuntimeBitmapPort bindings', () => {
  const previewSource = readFileSync('host/modules/ui/views/camera-preview/camera-preview-view.ts', 'utf8')

  assert.doesNotMatch(previewSource, /runtime-bitmap-port/)
  assert.doesNotMatch(previewSource, /new RuntimeBitmapPort\(/)
  assert.doesNotMatch(previewSource, /import config from 'mc\/config'/)
  assert.match(previewSource, /new Port\(/)
  assert.match(previewSource, /this\.reportRenderMode\('mosaic'\)/)
  assert.match(previewSource, /onRender\?: \(mode: CameraPreviewRenderMode\) => void/)
})

test('default camera preview prepares a simulator-safe mosaic frame', () => {
  const previewSource = readFileSync('host/modules/ui/views/camera-preview/camera-preview-view.ts', 'utf8')
  const behaviorSource = readFileSync('host/app/default-behavior/on-context-created.ts', 'utf8')

  assert.match(behaviorSource, /prepareCameraPreviewFrame\(frame\)/)
  assert.match(behaviorSource, /CAMERA_PREVIEW_CAPTURE_IMAGE_TYPE/)
  assert.match(behaviorSource, /format === 'RGB565BE' \? 'rgb565be' : 'rgb565le'/)
  assert.doesNotMatch(behaviorSource, /frame\.buffer\.slice\(0\)/)
  assert.doesNotMatch(behaviorSource, /buffer:\s*frame\.buffer/)
  assert.match(previewSource, /prepareCameraPreviewFrame/)
  assert.match(previewSource, /blocks: MosaicBlock\[\]/)
  assert.match(previewSource, /for \(const block of preview\.blocks\)/)
})

test('WASM camera preview uses a native RuntimeBitmapPort binding before falling back to mosaic', () => {
  const previewSource = readFileSync('host/modules/camera/wasm/camera-preview.ts', 'utf8')
  const portSource = readFileSync('host/modules/ui/views/camera-preview/runtime-bitmap-port.js', 'utf8')

  assert.match(portSource, /drawBitmap\(bitmap, x, y, sx = 0, sy = 0, sw = bitmap\.width, sh = bitmap\.height\)/)
  assert.match(portSource, /xs_stackchan_runtime_bitmap_port_draw/)
  assert.match(previewSource, /import RuntimeBitmapPort from 'runtime-bitmap-port'/)
  assert.match(previewSource, /from 'camera-preview-utils'/)
  assert.match(previewSource, /prepareCameraPreviewFrame\(frame: CameraFrame\): CameraPreviewFrame/)
  assert.match(previewSource, /return frame/)
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
  assert.match(modSource, /closeDrawer\(\)/)
  assert.match(modSource, /robot\.ui\.closeDrawer\(\)/)
  assert.match(modSource, /Timer\.set\(restoreCameraPreview, CAMERA_PREVIEW_DURATION_MS\)/)
  assert.doesNotMatch(modSource, /robot\.camera\.stop\(\)/)
})
