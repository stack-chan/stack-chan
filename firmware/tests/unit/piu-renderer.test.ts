import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const rendererPaths = [
  'stackchan/ui/application/renderer-simple.ts',
  'stackchan/ui/application/renderer-small.ts',
  'stackchan/ui/application/renderer-dog.ts',
  'stackchan/ui/application/renderer-image.ts',
  'stackchan/ui/application/renderer-compat.ts',
]

describe('PIU UI application lifecycle', () => {
  test('AppController reuses an existing startup Application when one is present', () => {
    const controllerSource = readFileSync('stackchan/ui/application/app-controller.ts', 'utf8')

    assert.match(controllerSource, /globalThis as GlobalWithApplication/)
    assert.match(controllerSource, /existingApplication\.empty\(\)/)
    assert.match(controllerSource, /existingApplication\.behavior = controller/)
    assert.match(controllerSource, /controller\.onCreate\(existingApplication, data\)/)
    assert.doesNotMatch(controllerSource, /addDecorator/)
    assert.doesNotMatch(controllerSource, /removeDecorator/)
  })

  test('standard application path constructs UI directly without legacy adapters', () => {
    const source = readFileSync('stackchan/main.ts', 'utf8')

    assert.match(source, /createAppControllerApplication/)
    assert.match(source, /new SimpleFace\(\)/)
    assert.match(source, /loadPreferences\('ui'\)/)
    assert.doesNotMatch(source, /createRenderer/)
    assert.doesNotMatch(source, /loadPreferences\('renderer'\)/)
    assert.doesNotMatch(source, /RendererCompat/)
  })

  test('UI manifests do not expose legacy adapter modules', () => {
    for (const manifestPath of ['stackchan/ui/manifest.json', 'stackchan/ui/manifest_wasm.json']) {
      const source = readFileSync(manifestPath, 'utf8')
      assert.doesNotMatch(source, /renderer-/)
      assert.doesNotMatch(source, /RendererCompat/)
    }

    for (const rendererPath of rendererPaths) {
      assert.equal(existsSync(rendererPath), false)
    }
  })
})
