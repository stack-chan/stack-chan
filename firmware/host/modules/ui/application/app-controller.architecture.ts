import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

// Tombstones for the removed renderer adapter layer; names are split so this
// file does not trip the legacy-name scan itself.
const legacyPrefix = ['renderer', ''].join('-')
const legacyCompatName = ['Renderer', 'Compat'].join('')
const legacyModulePaths = ['simple', 'small', 'dog', 'image', 'compat'].map(
  (name) => `host/modules/ui/application/${legacyPrefix}${name}.ts`,
)
const uiManifestPaths = ['host/modules/ui/manifest.json', 'host/modules/ui/manifest_wasm.json']
const qrCodeManifest = '$(MODDABLE)/modules/piu/MC/qrcode/manifest.json'

test('UI manifests bundle the QR code renderer for MODs', () => {
  for (const manifestPath of uiManifestPaths) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { include?: string[] }
    assert.ok(manifest.include?.includes(qrCodeManifest), manifestPath)
  }
})

test('UI manifests do not expose legacy renderer adapter modules', () => {
  for (const manifestPath of uiManifestPaths) {
    const source = readFileSync(manifestPath, 'utf8')
    assert.doesNotMatch(source, new RegExp(legacyPrefix))
    assert.doesNotMatch(source, new RegExp(legacyCompatName))
  }

  for (const legacyModulePath of legacyModulePaths) {
    assert.equal(existsSync(legacyModulePath), false)
  }
})
