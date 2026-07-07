import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

test('App exposes capability contracts instead of the concrete Robot facade at the MOD boundary', () => {
  const capabilities = readFileSync('host/app/capabilities.ts', 'utf8')
  const apiDocs = readFileSync('docs/api.md', 'utf8')
  const apiDocsJa = readFileSync('docs/api_ja.md', 'utf8')
  const appBehavior = readFileSync('host/app/default-behavior/behavior.ts', 'utf8')
  const defaultOnContextCreated = readFileSync('host/app/default-behavior/on-context-created.ts', 'utf8')
  const defaultOnLaunch = readFileSync('host/app/default-behavior/on-launch.ts', 'utf8')
  const setupMode = readFileSync('host/app/setup-mode.ts', 'utf8')
  const wasmAppBehavior = readFileSync('host/app/default-behavior/wasm/behavior.ts', 'utf8')
  const behaviorTypes = readFileSync('host/app/app-behavior.ts', 'utf8')
  const main = readFileSync('host/app/main.ts', 'utf8')
  const compose = readFileSync('host/app/compose.ts', 'utf8')
  const runtimeContext = readFileSync('host/app/runtime-context.ts', 'utf8')
  const runtimeAudio = readFileSync('host/app/runtime-audio.ts', 'utf8')
  const runtimeCamera = readFileSync('host/app/runtime-camera.ts', 'utf8')
  const runtimeInput = readFileSync('host/app/runtime-input.ts', 'utf8')
  const runtimeUI = readFileSync('host/app/runtime-ui.ts', 'utf8')
  const touch = readFileSync('host/modules/input/touch.ts', 'utf8')
  const motionController = readFileSync('host/modules/motion/motion-controller.ts', 'utf8')
  const manifest = JSON.parse(readFileSync('host/app/manifest.json', 'utf8'))
  const baseManifest = JSON.parse(readFileSync('host/app/manifest_base.json', 'utf8'))
  const factoryRegistryManifest = JSON.parse(readFileSync('host/app/manifest_factory_registry.json', 'utf8'))
  const allFactoriesManifest = JSON.parse(readFileSync('host/app/manifest_factories_all.json', 'utf8'))
  const audioManifest = JSON.parse(readFileSync('host/modules/audio/manifest.json', 'utf8'))
  const motionManifest = JSON.parse(readFileSync('host/modules/motion/manifest.json', 'utf8'))
  const motionWasmManifest = JSON.parse(readFileSync('host/modules/motion/manifest_wasm.json', 'utf8'))
  const wasmAppManifest = JSON.parse(readFileSync('host/app/manifest_wasm.json', 'utf8'))
  const wasmManifest = JSON.parse(readFileSync('host/platforms/wasm/manifest.json', 'utf8'))

  assert.doesNotMatch(behaviorTypes, /onRobotCreated/)
  assert.doesNotMatch(behaviorTypes, /behaviorFromMod/)
  assert.doesNotMatch(appBehavior, /from 'robot'/)
  assert.doesNotMatch(wasmAppBehavior, /from 'robot'/)

  assert.doesNotMatch(main, /createRobot\(\)/)
  assert.ok(
    main.indexOf('const shouldCreateContext = await runLaunchBehaviors(appBehaviors)') <
      main.indexOf('const bootServices = startHostBootServices()'),
    'host boot services should start after launch behavior has shown the splash screen',
  )
  assert.match(main, /createStackchanContext\(preferences, \{ connectivity: bootServices\.connectivity \}\)/)
  assert.doesNotMatch(compose, /as unknown as StackchanContext/)
  assert.match(compose, /new Touch\(config\.Touch, createTouchOptions\(\)\)/)
  assert.match(compose, /config\.TouchPanel \?\? globalEnv\.device\?\.sensor\?\.TouchPanel/)
  assert.match(compose, /new TouchPanel\(touchPanelConstructor\)/)
  assert.doesNotMatch(compose, /from 'robot'/)
  assert.doesNotMatch(touch, /from 'mc\/config'/)
  assert.match(touch, /export type TouchOptions/)
  assert.match(touch, /idleIntervalMs/)
  assert.match(touch, /activeIntervalMs/)

  assert.deepEqual(manifest.include, ['./manifest_base.json', './manifest_factories_all.json'])
  assert.ok(baseManifest.include.includes('./manifest_factory_registry.json'))
  assert.equal(factoryRegistryManifest.modules['stackchan-factory-registry'], './factory-registry/registry')
  assert.equal(factoryRegistryManifest.modules['stackchan-factory-registry/ui'], './factory-registry/ui')
  assert.equal(
    factoryRegistryManifest.modules['stackchan-factory-registry/register/motion/*'],
    './factory-registry/register/motion/*',
  )
  assert.equal(
    factoryRegistryManifest.modules['stackchan-factory-registry/register/tts/*'],
    './factory-registry/register/tts/*',
  )
  assert.equal(
    factoryRegistryManifest.modules['stackchan-factory-registry/register/ui/*'],
    './factory-registry/register/ui/*',
  )
  assert.ok(baseManifest.modules['*'].includes('./app-behavior'))
  assert.ok(baseManifest.modules['*'].includes('./setup-mode'))
  assert.ok(baseManifest.modules['*'].includes('./capabilities'))
  assert.ok(baseManifest.modules['*'].includes('./runtime-audio'))
  assert.ok(baseManifest.modules['*'].includes('./runtime-camera'))
  assert.ok(baseManifest.modules['*'].includes('./runtime-context'))
  assert.ok(baseManifest.modules['*'].includes('./runtime-input'))
  assert.ok(baseManifest.modules['*'].includes('./runtime-lighting'))
  assert.ok(baseManifest.modules['*'].includes('./runtime-ui'))
  assert.ok(!baseManifest.modules['*'].includes('./runtime-motion'))
  assert.ok(!baseManifest.modules['*'].includes('../../stackchan/robot'))
  assert.ok(!baseManifest.include.includes('$(MODDABLE)/examples/manifest_net.json'))
  assert.ok(motionManifest.preload.includes('motion-controller'))
  assert.deepEqual(motionManifest.preload, ['motion-controller'])
  assert.deepEqual(audioManifest.preload, ['audio-in', 'audio-buffer', 'microphone', 'speaker'])
  assert.deepEqual(allFactoriesManifest.preload.sort(), [
    'stackchan-factory-registry/register/motion/dynamixel',
    'stackchan-factory-registry/register/motion/m5stackchan',
    'stackchan-factory-registry/register/motion/none',
    'stackchan-factory-registry/register/motion/pwm',
    'stackchan-factory-registry/register/motion/rs30x',
    'stackchan-factory-registry/register/motion/scservo',
    'stackchan-factory-registry/register/tts/elevenlabs',
    'stackchan-factory-registry/register/tts/local',
    'stackchan-factory-registry/register/tts/openai',
    'stackchan-factory-registry/register/tts/remote',
    'stackchan-factory-registry/register/tts/voicevox',
    'stackchan-factory-registry/register/tts/voicevox-web',
    'stackchan-factory-registry/register/ui/dog',
    'stackchan-factory-registry/register/ui/image',
    'stackchan-factory-registry/register/ui/simple',
    'stackchan-factory-registry/register/ui/small-face',
  ])
  assert.doesNotMatch(compose, /from 'scservo-driver'/)
  assert.doesNotMatch(compose, /from 'sg90-driver'/)
  assert.doesNotMatch(compose, /from 'dynamixel-driver'/)
  assert.doesNotMatch(compose, /from 'tts-local'/)
  assert.doesNotMatch(compose, /from 'tts-openai'/)
  assert.doesNotMatch(compose, /from 'behaviors\/face'/)
  assert.equal(motionWasmManifest.modules['motion-controller'], './motion-controller')
  assert.equal(baseManifest.modules['app-default-behavior'], './default-behavior/behavior')
  assert.equal(baseManifest.modules['app-default-behavior/on-context-created'], './default-behavior/on-context-created')
  assert.equal(baseManifest.modules['app-default-behavior/on-launch'], './default-behavior/on-launch')
  assert.equal(baseManifest.modules['app-default-behavior/startup-choice'], './default-behavior/startup-choice')
  assert.equal(baseManifest.modules['app-default-behavior/*'], undefined)
  assert.equal(baseManifest.modules['app-behavior'], './app-behavior')
  assert.ok(wasmAppManifest.include.includes('../platforms/wasm/manifest.json'))
  assert.ok(wasmAppManifest.include.includes('./manifest_factory_registry.json'))
  assert.ok(wasmAppManifest.include.includes('./manifest_factories_all.json'))
  assert.ok(wasmManifest.modules['*'].includes('../../app/app-behavior'))
  assert.ok(wasmManifest.modules['*'].includes('../../app/setup-mode'))
  assert.ok(wasmManifest.modules['*'].includes('../../app/capabilities'))
  assert.ok(wasmManifest.modules['*'].includes('../../app/runtime-audio'))
  assert.ok(wasmManifest.modules['*'].includes('../../app/runtime-camera'))
  assert.ok(wasmManifest.modules['*'].includes('../../app/runtime-context'))
  assert.ok(wasmManifest.modules['*'].includes('../../app/runtime-input'))
  assert.ok(wasmManifest.modules['*'].includes('../../app/runtime-lighting'))
  assert.ok(wasmManifest.modules['*'].includes('../../app/runtime-ui'))
  assert.ok(!wasmManifest.modules['*'].includes('../../app/runtime-motion'))
  assert.ok(!wasmManifest.modules['*'].includes('../../stackchan/robot'))
  assert.equal(wasmManifest.modules['app-default-behavior'], '../../app/default-behavior/wasm/behavior')
  assert.equal(
    wasmManifest.modules['app-default-behavior/on-context-created'],
    '../../app/default-behavior/on-context-created',
  )
  assert.equal(wasmManifest.modules['app-default-behavior/*'], undefined)
  assert.equal(wasmManifest.modules['app-behavior'], '../../app/app-behavior')

  assert.doesNotMatch(defaultOnLaunch, /from 'network-manager'/)
  assert.doesNotMatch(defaultOnLaunch, /from 'stored-wifi'/)
  assert.doesNotMatch(defaultOnLaunch, /from 'settings-view'/)
  assert.doesNotMatch(defaultOnLaunch, /from 'preference-server'/)
  assert.match(defaultOnLaunch, /from 'setup-mode'/)
  assert.match(setupMode, /from 'stored-wifi'/)
  assert.match(setupMode, /from 'settings-view'/)
  assert.match(setupMode, /from 'preference-server'/)
  assert.doesNotMatch(setupMode, /from 'network-manager'/)

  assert.doesNotMatch(runtimeContext, /createFaceState/)
  assert.doesNotMatch(runtimeContext, /SpeechBalloon/)
  assert.doesNotMatch(runtimeContext, /DrawerButtonSpec/)
  assert.doesNotMatch(capabilities, /export type Driver = MotionDriver/)
  assert.doesNotMatch(capabilities, /driver: Driver/)
  assert.doesNotMatch(capabilities, /from 'led'/)
  assert.match(capabilities, /export type NetworkReadyResult/)
  assert.match(capabilities, /network\?: NetworkCapability/)
  assert.match(capabilities, /export type LifecycleCapability/)
  assert.match(capabilities, /lifecycle: LifecycleCapability/)
  assert.doesNotMatch(capabilities, /network\?: unknown/)
  assert.match(capabilities, /useTTS\(tts: TTS\): void/)
  assert.match(apiDocs, /Lifecycle and errors/)
  assert.match(apiDocs, /Optional hardware capabilities are represented as `undefined`/)
  assert.match(apiDocs, /Promises reject for failed asynchronous commands/)
  assert.match(apiDocs, /`trace\(\.\.\.\)` may add diagnostics, but it must not be the only failure signal/)
  assert.match(apiDocsJa, /### ライフサイクルとエラー/)
  assert.match(apiDocsJa, /optional hardware capability は `undefined`/)
  assert.match(apiDocsJa, /Promise rejection/)
  assert.match(apiDocsJa, /唯一の失敗通知にしてはいけません/)
  assert.doesNotMatch(runtimeContext, /as unknown as StackchanContext/)
  assert.match(runtimeContext, /params\.connectivity \?\? \{\}/)
  assert.doesNotMatch(runtimeContext, /^\s+seed:/m)
  assert.doesNotMatch(runtimeContext, /^\s+useUI\(/m)
  assert.doesNotMatch(runtimeContext, /^\s+useDriver\(/m)
  assert.doesNotMatch(runtimeContext, /^\s+pause\(/m)
  assert.doesNotMatch(runtimeContext, /^\s+resume\(/m)
  assert.doesNotMatch(runtimeContext, /^\s+updatePose\(/m)
  assert.match(runtimeContext, /#updateFace = \(\) =>/)
  assert.doesNotMatch(runtimeAudio, /function waitForSpeech/)
  assert.doesNotMatch(runtimeContext, /function waitForMotion/)
  assert.doesNotMatch(runtimeContext, /get driver\(\)/)
  assert.doesNotMatch(defaultOnContextCreated, /touchPanel\.stop\(/)
  assert.doesNotMatch(defaultOnContextCreated, /touchPanel\?\.start\(/)
  assert.doesNotMatch(defaultOnContextCreated, /touchPanel\.start\(/)
  assert.doesNotMatch(motionController, /async setPose/)
  assert.doesNotMatch(motionController, /setPose\(pose: Pose, time\?: number\): Promise<void>/)
  assert.match(runtimeUI, /createFaceState/)
  assert.match(runtimeUI, /SpeechBalloon/)
  assert.match(runtimeUI, /DrawerButtonSpec/)
  assert.match(runtimeUI, /writeBodyRelativeVector3/)
  assert.match(runtimeUI, /writePositionRelativeVector3/)
  assert.match(runtimeUI, /writeRotationFromVector3/)
  assert.match(runtimeCamera, /touchPanel\?: ManagedTouchPanel/)
  assert.match(runtimeCamera, /#pauseTouchPanel\(\)/)
  assert.match(runtimeCamera, /#resumeTouchPanel\(\)/)
  assert.match(runtimeCamera, /capture\(options\?: Parameters<RobotCamera\['capture'\]>\[0\]\)/)
  assert.match(runtimeInput, /close\(\): void/)
  assert.match(runtimeInput, /#touch\?\.close\(\)/)
  assert.match(runtimeInput, /#touchPanel\?\.close\(\)/)
  assert.match(runtimeInput, /#imu\?\.close\(\)/)
  assert.match(runtimeContext, /#updateFaceHandler: Timer \| undefined/)
  assert.match(runtimeContext, /Timer\.clear\(this\.#updateFaceHandler\)/)
  assert.match(runtimeContext, /#motionController\.close\(\)/)
  assert.match(runtimeContext, /#inputRuntime\.close\(\)/)
  assert.match(touch, /close\(\): void/)
  assert.match(touch, /Timer\.clear\(this\.#touch\.timer\)/)
  assert.match(touch, /Timer\.clear\(this\.#legacyTimer\)/)
  assert.doesNotMatch(runtimeUI, /Vector3\.(?:rotate|sub)/)
  assert.doesNotMatch(runtimeUI, /Rotation\.fromVector3/)
  assert.doesNotMatch(runtimeUI, /drawerController/)
  assert.doesNotMatch(runtimeUI, /application as/)
})

test('sample MODs use namespaced context capabilities', () => {
  const root = 'mods/examples'
  const files: string[] = []
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) {
        visit(path)
      } else if (path.endsWith('.js')) {
        files.push(path)
      }
    }
  }
  visit(root)

  const flatApiPattern =
    /\brobot\.(say|record|tone|playAudio|useTTS|lookAt|lookAway|setPose|setTorque|setEmotion|setColor|showBalloon|hideBalloon|lightOn|lightOff|lightBlink|lightRainbow|button|touch|touchPanel|imu|led|tts|microphone|drawer)\b/

  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    assert.doesNotMatch(source, flatApiPattern, `${file} should use namespaced StackchanContext capabilities`)
  }
})
