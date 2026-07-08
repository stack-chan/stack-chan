import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const manifestPath = 'host/app/manifest.json'
const wasmAppManifestPath = 'host/app/manifest_wasm.json'
const wasmManifestPath = 'host/platforms/wasm/manifest.json'
const splashFontResource = '$(MODDABLE)/examples/assets/fonts/OpenSans-Regular-24'

function readManifest(path: string) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

describe('startup splash screen manifest wiring', () => {
  test('does not register a startup splash image resource for device or wasm builds', () => {
    for (const manifest of [
      readManifest(manifestPath),
      readManifest(wasmAppManifestPath),
      readManifest(wasmManifestPath),
    ]) {
      assert.equal(JSON.stringify(manifest.resources ?? {}).includes('./assets/images/startup-splash'), false)
    }
  })

  test('uses a font resource registered for both device and wasm builds', () => {
    const manifest = readManifest(manifestPath)
    const wasmManifest = readManifest(wasmAppManifestPath)

    assert.deepEqual(manifest.resources['*-mask'], [splashFontResource])
    assert.deepEqual(wasmManifest.resources['*-mask'], [splashFontResource])
  })

  test('app manifests resolve device and wasm startup behavior through explicit module specifiers', () => {
    const manifest = readManifest(manifestPath)
    const appManifest = readManifest(wasmAppManifestPath)
    const wasmManifest = readManifest(wasmManifestPath)

    assert.equal(manifest.modules['app-default-behavior'], './default-behavior/behavior')
    assert.equal(manifest.modules['app-default-behavior/on-context-created'], './default-behavior/on-context-created')
    assert.equal(manifest.modules['app-default-behavior/on-launch'], './default-behavior/on-launch')
    assert.equal(manifest.modules['app-default-behavior/startup-choice'], './default-behavior/startup-choice')
    assert.equal(manifest.modules['app-default-behavior/*'], undefined)
    assert.ok(appManifest.include.includes('../platforms/wasm/manifest.json'))
    assert.equal(wasmManifest.modules['app-default-behavior'], '../../app/default-behavior/wasm/behavior')
    assert.equal(
      wasmManifest.modules['app-default-behavior/wasm/on-launch'],
      '../../app/default-behavior/wasm/on-launch',
    )
    assert.equal(
      wasmManifest.modules['app-default-behavior/on-context-created'],
      '../../app/default-behavior/on-context-created',
    )
    assert.equal(wasmManifest.modules['app-default-behavior/*'], undefined)
  })
})
