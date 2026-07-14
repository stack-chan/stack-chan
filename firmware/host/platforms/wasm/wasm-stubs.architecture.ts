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

test('WASM servo driver facades map through the manifest and re-export the consolidated WasmDriver', () => {
  const manifest = readManifest('host/modules/motion/manifest_wasm.json')
  const driverNames = [
    'dynamixel-driver',
    'm5stackchan-servo-driver',
    'none-driver',
    'sg90-driver',
    'rs30x-driver',
    'scservo-driver',
  ]

  for (const driverName of driverNames) {
    assert.equal(manifest.modules[driverName], `./wasm/${driverName}`)
    const source = readFileSync(`host/modules/motion/wasm/${driverName}.ts`, 'utf8')
    assert.match(source, /from 'wasm-driver'/)
    assert.doesNotMatch(source, /\.\//)
  }
})

test('WASM PY32 LED facade re-exports the shared LED stub through a manifest module specifier', () => {
  const source = readFileSync('host/modules/lighting/wasm/py32-led.ts', 'utf8')

  assert.match(source, /from 'led'/)
  assert.doesNotMatch(source, /\.\//)
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

test('camera preview aliases keep WASM-only bindings out of the shared import graph', () => {
  const manifest = readManifest('host/app/manifest.json')

  // The generic/default alias (used by the Linux simulator) stays on the mosaic-only view so no
  // WASM-only native binding leaks into the Linux import graph.
  assert.equal(manifest.modules['camera-preview'], '../modules/ui/views/camera-preview/camera-preview-view')

  // esp32 device builds include manifest_device.json, which overrides camera-preview with a
  // bitmap-capable module so the real camera image is drawn (mosaic remains the fallback).
  const deviceManifest = readManifest('host/modules/camera/manifest_device.json')
  assert.equal(deviceManifest.modules['camera-preview'], './device/camera-preview')

  const wasmManifest = readManifest('host/modules/camera/manifest_wasm.json')
  assert.equal(wasmManifest.modules['camera-preview'], './wasm/camera-preview')

  const previewSource = readFileSync('host/modules/ui/views/camera-preview/camera-preview-view.ts', 'utf8')
  assert.doesNotMatch(previewSource, /runtime-bitmap-port/)
  assert.doesNotMatch(previewSource, /new RuntimeBitmapPort\(/)
})
