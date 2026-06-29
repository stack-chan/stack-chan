import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('App exposes capability contracts instead of the concrete Robot facade at the MOD boundary', () => {
  const capabilities = readFileSync('host/app/capabilities.ts', 'utf8')
  const mod = readFileSync('host/app/default-behavior/mod.ts', 'utf8')
  const wasmMod = readFileSync('host/app/default-behavior/wasm/mod.ts', 'utf8')
  const main = readFileSync('host/app/main.ts', 'utf8')
  const compose = readFileSync('host/app/compose.ts', 'utf8')
  const manifest = JSON.parse(readFileSync('host/app/manifest.json', 'utf8'))
  const wasmManifest = JSON.parse(readFileSync('host/app/manifest_wasm.json', 'utf8'))

  for (const capability of [
    'FaceCapability',
    'MotionCapability',
    'AudioCapability',
    'InputCapability',
    'LightingCapability',
    'CameraCapability',
    'ConversationCapability',
    'ConnectivityCapability',
    'UICapability',
    'StackchanContext',
  ]) {
    assert.match(capabilities, new RegExp(`export type ${capability}\\b`))
  }

  assert.match(mod, /import type \{ StackchanContext \} from 'capabilities'/)
  assert.match(wasmMod, /import type \{ StackchanContext \} from 'capabilities'/)
  assert.doesNotMatch(mod, /from 'robot'/)
  assert.doesNotMatch(wasmMod, /from 'robot'/)

  assert.match(main, /createStackchanContext\(\)/)
  assert.doesNotMatch(main, /createRobot\(\)/)
  assert.match(compose, /export function createStackchanContext\(\): StackchanContext/)
  assert.match(compose, /new StackchanRuntimeContext\(/)
  assert.doesNotMatch(compose, /from 'robot'/)

  assert.ok(manifest.modules['*'].includes('./capabilities'))
  assert.ok(manifest.modules['*'].includes('./runtime-context'))
  assert.ok(!manifest.modules['*'].includes('../../stackchan/robot'))
  assert.ok(wasmManifest.modules['*'].includes('./capabilities'))
  assert.ok(wasmManifest.modules['*'].includes('./runtime-context'))
  assert.ok(!wasmManifest.modules['*'].includes('../../stackchan/robot'))
})
