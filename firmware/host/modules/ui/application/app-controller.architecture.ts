import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const legacyPrefix = ['renderer', ''].join('-')
const legacyCompatName = ['Renderer', 'Compat'].join('')
const legacyAddDecoratorName = ['add', 'Decorator'].join('')
const legacyRemoveDecoratorName = ['remove', 'Decorator'].join('')
const legacyCreateName = ['create', 'Renderer'].join('')
const legacyModulePaths = ['simple', 'small', 'dog', 'image', 'compat'].map(
  (name) => `host/modules/ui/application/${legacyPrefix}${name}.ts`,
)

describe('PIU UI application lifecycle', () => {
  test('AppController reuses an existing startup Application when one is present', () => {
    const controllerSource = readFileSync('host/modules/ui/application/app-controller.ts', 'utf8')

    assert.match(controllerSource, /globalThis as GlobalWithApplication/)
    assert.match(controllerSource, /existingApplication\.empty\(\)/)
    assert.match(controllerSource, /existingApplication\.behavior = controller/)
    assert.match(controllerSource, /controller\.onCreate\(existingApplication, data\)/)
    assert.doesNotMatch(controllerSource, new RegExp(legacyAddDecoratorName))
    assert.doesNotMatch(controllerSource, new RegExp(legacyRemoveDecoratorName))
  })

  test('standard application path constructs UI directly without legacy adapters', () => {
    const source = readFileSync('host/app/compose.ts', 'utf8')

    assert.match(source, /createAppControllerApplication/)
    assert.match(source, /new SimpleFace\(\)/)
    assert.match(source, /preferences\.ui/)
    assert.doesNotMatch(source, new RegExp(legacyCreateName))
    assert.doesNotMatch(source, /loadPreferences\('renderer'\)/)
    assert.doesNotMatch(source, new RegExp(legacyCompatName))
  })

  test('UI manifests do not expose legacy adapter modules', () => {
    for (const manifestPath of ['host/modules/ui/manifest.json', 'host/modules/ui/manifest_wasm.json']) {
      const source = readFileSync(manifestPath, 'utf8')
      assert.doesNotMatch(source, new RegExp(legacyPrefix))
      assert.doesNotMatch(source, new RegExp(legacyCompatName))
    }

    for (const legacyModulePath of legacyModulePaths) {
      assert.equal(existsSync(legacyModulePath), false)
    }
  })
})
