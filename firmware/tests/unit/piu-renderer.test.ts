import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const rendererPaths = [
  'stackchan/ui/application/renderer-simple.ts',
  'stackchan/ui/application/renderer-small.ts',
  'stackchan/ui/application/renderer-dog.ts',
  'stackchan/ui/application/renderer-image.ts',
]

describe('PIU renderer application lifecycle', () => {
  test('renderers reuse an existing startup Application when one is present', () => {
    const controllerSource = readFileSync('stackchan/ui/application/app-controller.ts', 'utf8')

    assert.match(controllerSource, /globalThis as GlobalWithApplication/)
    assert.match(controllerSource, /existingApplication\.empty\(\)/)
    assert.match(controllerSource, /existingApplication\.behavior = controller/)
    assert.match(controllerSource, /controller\.onCreate\(existingApplication, data\)/)

    for (const rendererPath of rendererPaths) {
      const source = readFileSync(rendererPath, 'utf8')

      assert.match(source, /createAppControllerApplication/)
      assert.doesNotMatch(source, /new Application/)
    }
  })
})
