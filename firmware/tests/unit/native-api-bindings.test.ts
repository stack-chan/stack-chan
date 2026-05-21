import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'

const firmwareRoot = process.cwd()

const nativeBindingModules = [
  'stackchan/runtime-bitmap-port.js',
  'stackchan/wasm/audio-bridge.js',
  'stackchan/wasm/camera-bridge.js',
]

test('native binding bridge modules use Moddable Native API instead of @ syntax', () => {
  const legacyBindings = nativeBindingModules.flatMap((modulePath) => {
    const source = readFileSync(resolve(firmwareRoot, modulePath), 'utf8')

    return source
      .split('\n')
      .map((line, index) => ({ line, lineNumber: index + 1, modulePath }))
      .filter(({ line }) => /\)\s*@\s*['"]xs_/.test(line))
      .map(({ modulePath, lineNumber, line }) => `${modulePath}:${lineNumber}: ${line.trim()}`)
  })

  assert.deepEqual(legacyBindings, [])
})
