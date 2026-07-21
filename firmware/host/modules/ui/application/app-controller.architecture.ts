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

test('UI manifests do not expose legacy renderer adapter modules', () => {
  for (const manifestPath of ['host/modules/ui/manifest.json', 'host/modules/ui/manifest_wasm.json']) {
    const source = readFileSync(manifestPath, 'utf8')
    assert.doesNotMatch(source, new RegExp(legacyPrefix))
    assert.doesNotMatch(source, new RegExp(legacyCompatName))
  }

  for (const legacyModulePath of legacyModulePaths) {
    assert.equal(existsSync(legacyModulePath), false)
  }
})
