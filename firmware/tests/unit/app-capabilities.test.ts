import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('App exposes capability contracts instead of the concrete Robot facade at the MOD boundary', () => {
  const capabilities = readFileSync('host/app/capabilities.ts', 'utf8')
  const mod = readFileSync('host/app/default-behavior/mod.ts', 'utf8')
  const wasmMod = readFileSync('host/app/default-behavior/wasm/mod.ts', 'utf8')
  const main = readFileSync('host/app/main.ts', 'utf8')
  const compose = readFileSync('host/app/compose.ts', 'utf8')
  const runtimeContext = readFileSync('host/app/runtime-context.ts', 'utf8')
  const runtimeUI = readFileSync('host/app/runtime-ui.ts', 'utf8')
  const manifest = JSON.parse(readFileSync('host/app/manifest.json', 'utf8'))
  const wasmAppManifest = JSON.parse(readFileSync('host/app/manifest_wasm.json', 'utf8'))
  const wasmManifest = JSON.parse(readFileSync('host/platforms/wasm/manifest.json', 'utf8'))

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
  assert.ok(manifest.modules['*'].includes('./runtime-audio'))
  assert.ok(manifest.modules['*'].includes('./runtime-camera'))
  assert.ok(manifest.modules['*'].includes('./runtime-context'))
  assert.ok(manifest.modules['*'].includes('./runtime-input'))
  assert.ok(manifest.modules['*'].includes('./runtime-lighting'))
  assert.ok(manifest.modules['*'].includes('./runtime-motion'))
  assert.ok(manifest.modules['*'].includes('./runtime-ui'))
  assert.ok(!manifest.modules['*'].includes('../../stackchan/robot'))
  assert.ok(wasmAppManifest.include.includes('../platforms/wasm/manifest.json'))
  assert.ok(wasmManifest.modules['*'].includes('../../app/capabilities'))
  assert.ok(wasmManifest.modules['*'].includes('../../app/runtime-audio'))
  assert.ok(wasmManifest.modules['*'].includes('../../app/runtime-camera'))
  assert.ok(wasmManifest.modules['*'].includes('../../app/runtime-context'))
  assert.ok(wasmManifest.modules['*'].includes('../../app/runtime-input'))
  assert.ok(wasmManifest.modules['*'].includes('../../app/runtime-lighting'))
  assert.ok(wasmManifest.modules['*'].includes('../../app/runtime-motion'))
  assert.ok(wasmManifest.modules['*'].includes('../../app/runtime-ui'))
  assert.ok(!wasmManifest.modules['*'].includes('../../stackchan/robot'))

  assert.doesNotMatch(runtimeContext, /createFaceState/)
  assert.doesNotMatch(runtimeContext, /SpeechBalloon/)
  assert.doesNotMatch(runtimeContext, /DrawerButtonSpec/)
  assert.doesNotMatch(runtimeContext, /#tts:/)
  assert.doesNotMatch(runtimeContext, /#driver:/)
  assert.doesNotMatch(runtimeContext, /#button:/)
  assert.doesNotMatch(runtimeContext, /#touch:/)
  assert.doesNotMatch(runtimeContext, /#touchPanel:/)
  assert.doesNotMatch(runtimeContext, /#imu:/)
  assert.doesNotMatch(runtimeContext, /#microphone:/)
  assert.doesNotMatch(runtimeContext, /#camera:/)
  assert.doesNotMatch(runtimeContext, /#tone:/)
  assert.doesNotMatch(runtimeContext, /#led:/)
  assert.doesNotMatch(runtimeContext, /#pose:/)
  assert.doesNotMatch(runtimeContext, /#gazePoint:/)
  assert.match(runtimeContext, /#uiRuntime/)
  assert.match(runtimeContext, /#audioRuntime/)
  assert.match(runtimeContext, /#cameraRuntime/)
  assert.match(runtimeContext, /#inputRuntime/)
  assert.match(runtimeContext, /#lightingRuntime/)
  assert.match(runtimeContext, /#motionRuntime/)
  assert.match(runtimeUI, /createFaceState/)
  assert.match(runtimeUI, /SpeechBalloon/)
  assert.match(runtimeUI, /DrawerButtonSpec/)
})
