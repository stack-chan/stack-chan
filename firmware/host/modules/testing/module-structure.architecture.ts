import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

const MODULE_ROOT = 'host/modules'
const PRODUCTION_MANIFEST_ROOTS = ['host/app', 'host/modules', 'host/platforms', 'mods/examples'] as const
const RUNTIME_MODULES = [
  'audio',
  'camera',
  'connectivity',
  'conversation',
  'io-expander',
  'input',
  'lighting',
  'motion',
  'preferences',
  'ui',
  'util',
] as const

function walkFiles(root: string): string[] {
  const entries = readdirSync(root)
  const files: string[] = []
  for (const entry of entries) {
    const path = join(root, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      files.push(...walkFiles(path))
    } else {
      files.push(path)
    }
  }
  return files
}

function readJson(path: string) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function collectStringValues(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(collectStringValues)
  if (value && typeof value === 'object') return Object.values(value).flatMap(collectStringValues)
  return []
}

function isProductionManifest(path: string): boolean {
  return (
    /[/\\]manifest(?:_[^/\\]+)?\.json$/.test(path) &&
    !path.endsWith('manifest.test.json') &&
    !path.endsWith('manifest_local.json')
  )
}

function isTestOrArchitectureTarget(value: string): boolean {
  const normalized = value.replaceAll('\\', '/')
  return (
    normalized.includes('/__tests__/') ||
    normalized.startsWith('__tests__/') ||
    normalized.includes('manifest.test.json') ||
    /\.test(?:$|[./])/.test(normalized) ||
    /\.architecture(?:$|[./])/.test(normalized)
  )
}

function extractMethodBlocks(source: string, methodName: string): string[] {
  const blocks: string[] = []
  const pattern = new RegExp(`${methodName}\\([^)]*\\)(?:\\s*:[^{]+)?\\s*\\{`, 'g')
  let match: RegExpExecArray | null = pattern.exec(source)
  while (match) {
    const open = source.indexOf('{', match.index)
    let depth = 0
    for (let i = open; i < source.length; i++) {
      const ch = source[i]
      if (ch === '{') depth += 1
      if (ch === '}') depth -= 1
      if (depth === 0) {
        blocks.push(source.slice(match.index, i + 1))
        pattern.lastIndex = i + 1
        break
      }
    }
    match = pattern.exec(source)
  }
  return blocks
}

function isSourceFile(path: string): boolean {
  return /\.(?:ts|js)$/.test(path)
}

type ModuleSpecifierUse = {
  readonly specifier: string
  readonly typeOnly: boolean
}

function extractModuleSpecifiers(source: string): string[] {
  const specifiers: string[] = []
  for (const match of source.matchAll(/\bimport\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/g)) {
    specifiers.push(match[1])
  }
  for (const match of source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    specifiers.push(match[1])
  }
  return specifiers
}

function extractRuntimeModuleSpecifierUses(source: string): ModuleSpecifierUse[] {
  const specifiers: ModuleSpecifierUse[] = []
  for (const match of source.matchAll(/\bimport\s+(type\s+)?(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/g)) {
    specifiers.push({ specifier: match[2], typeOnly: match[1] !== undefined })
  }
  for (const match of source.matchAll(/\bexport\s+(type\s+)?[^'"]*\s+from\s+['"]([^'"]+)['"]/g)) {
    specifiers.push({ specifier: match[2], typeOnly: match[1] !== undefined })
  }
  for (const match of source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    specifiers.push({ specifier: match[1], typeOnly: false })
  }
  return specifiers
}

function isInternalModuleSpecifier(specifier: string): boolean {
  return (
    specifier.startsWith('../') ||
    specifier.startsWith('host/') ||
    specifier.startsWith('modules/') ||
    specifier.startsWith('platforms/') ||
    specifier.startsWith('app/') ||
    specifier.includes('/internal/')
  )
}

function isRelativeModuleSpecifier(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../')
}

test('runtime modules own implementation manifests and tests under host/modules', () => {
  for (const moduleName of RUNTIME_MODULES) {
    const moduleDir = join(MODULE_ROOT, moduleName)
    assert.ok(existsSync(join(moduleDir, 'manifest.json')), `${moduleName} should have manifest.json`)
    assert.equal(
      existsSync(join(moduleDir, 'manifest.test.json')),
      false,
      `${moduleName} should not keep a placeholder manifest.test.json`,
    )

    const files = walkFiles(moduleDir)
    assert.ok(
      files.some((path) => /(?:^|[/\\])[^/\\]+\.test\.(?:ts|js)$/.test(path)),
      `${moduleName} should own tests`,
    )
  }
})

test('production runtime imports use manifest module specifiers instead of relative paths', () => {
  const offenders = PRODUCTION_MANIFEST_ROOTS.flatMap((root) => walkFiles(root))
    .filter(isSourceFile)
    .filter((path) => !isTestOrArchitectureTarget(path))
    .flatMap((sourcePath) =>
      extractRuntimeModuleSpecifierUses(readFileSync(sourcePath, 'utf8'))
        .filter(({ typeOnly }) => !typeOnly)
        .filter(({ specifier }) => isRelativeModuleSpecifier(specifier))
        .map(({ specifier }) => `${sourcePath}: ${specifier}`),
    )

  assert.deepEqual(offenders, [])
})

test('low-level motion, input, and UI modules avoid async and Promise control flow', () => {
  const sourcePaths = [join(MODULE_ROOT, 'motion'), join(MODULE_ROOT, 'input'), join(MODULE_ROOT, 'ui')]
    .flatMap((root) => walkFiles(root))
    .filter(isSourceFile)
    .filter((path) => !/[/\\]__tests__[/\\]/.test(path))
    .filter((path) => !path.startsWith(join(MODULE_ROOT, 'testing')))
    .filter((path) => !/[/\\]wasm[/\\]/.test(path))

  for (const sourcePath of sourcePaths) {
    const source = readFileSync(sourcePath, 'utf8')
    assert.doesNotMatch(
      source,
      /\basync\b|\bPromise\b|new Promise|Promise\.|\.then\(|\.catch\(/,
      `${sourcePath} should use callback/state flow instead of async or Promise`,
    )
  }
})

test('Timer and input handlers do not inline async functions', () => {
  const sourcePaths = [join('host', 'app'), MODULE_ROOT, join('mods', 'examples')]
    .flatMap((root) => walkFiles(root))
    .filter(isSourceFile)
    .filter((path) => !/[/\\]__tests__[/\\]/.test(path))

  for (const sourcePath of sourcePaths) {
    const source = readFileSync(sourcePath, 'utf8')
    assert.doesNotMatch(
      source,
      /Timer\.(?:set|repeat)\(\s*async\b/,
      `${sourcePath} should not use async Timer handlers`,
    )
    assert.doesNotMatch(source, /onEvent\s*=\s*async\b/, `${sourcePath} should not use async input handlers`)
    assert.doesNotMatch(source, /onEvent\s*=\s*async\s+function\b/, `${sourcePath} should not use async input handlers`)
    assert.doesNotMatch(source, /void\s*\(\s*async\b/, `${sourcePath} should not use inline async IIFEs`)
  }
})

test('periodic motion hot paths reuse fixed state and callbacks', () => {
  const controller = readFileSync(join(MODULE_ROOT, 'motion', 'motion-controller.ts'), 'utf8')
  const updatePoseBlocks = extractMethodBlocks(controller, 'updatePose')

  assert.equal(updatePoseBlocks.length, 1, 'MotionController should have one updatePose hot path')
  assert.doesNotMatch(controller, /Vector3\.rotate/, 'MotionController should avoid allocating Vector3.rotate')
  assert.doesNotMatch(
    controller,
    /Rotation\.fromVector3/,
    'MotionController should avoid allocating Rotation.fromVector3',
  )
  assert.doesNotMatch(controller, /getRotation\(\s*\(/, 'MotionController should reuse getRotation callback')
  assert.doesNotMatch(controller, /setTorque\(true,\s*\(/, 'MotionController should reuse setTorque callback')
  assert.doesNotMatch(
    controller,
    /applyRotation\([^,\n]+,\s*[^,\n]+,\s*\(/,
    'MotionController should reuse applyRotation callback',
  )
  assert.doesNotMatch(controller, /Timer\.set\(\s*\(/, 'MotionController should reuse Timer callback')

  for (const block of updatePoseBlocks) {
    assert.doesNotMatch(block, /\bnew\b/, 'updatePose should not allocate objects')
    assert.doesNotMatch(block, /(?:=|return|,\s*)\s*\{/, 'updatePose should not create object literals')
    assert.doesNotMatch(block, /(?:=|return|,\s*)\s*\[/, 'updatePose should not create array literals')
    assert.doesNotMatch(block, /\.\s*(?:map|filter|reduce)\s*\(/, 'updatePose should not allocate arrays')
  }

  const driverFiles = [
    'dynamixel-driver.ts',
    'm5stackchan-servo-driver.ts',
    'none-driver.ts',
    'rs30x-driver.ts',
    'scservo-driver.ts',
    'sg90-driver.ts',
    'wasm/wasm-driver.ts',
  ]
  for (const driverFile of driverFiles) {
    const driverPath = join(MODULE_ROOT, 'motion', driverFile)
    const driver = readFileSync(driverPath, 'utf8')
    const getRotationBlocks = extractMethodBlocks(driver, 'getRotation')
    assert.equal(getRotationBlocks.length, 1, `${driverPath} should have one getRotation path`)
    assert.doesNotMatch(getRotationBlocks[0], /callback\(\s*\{/, `${driverPath} should reuse getRotation result`)
    assert.doesNotMatch(getRotationBlocks[0], /value:\s*\{/, `${driverPath} should reuse getRotation value`)
    assert.doesNotMatch(
      getRotationBlocks[0],
      /(?:=|return|,\s*)\s*\[/,
      `${driverPath} should not create array literals`,
    )
    assert.doesNotMatch(
      getRotationBlocks[0],
      /\.\s*(?:map|filter|reduce)\s*\(/,
      `${driverPath} should not allocate arrays`,
    )
    assert.doesNotMatch(getRotationBlocks[0], /\.\.\./, `${driverPath} should not use spread`)
  }
})

test('motion protocol continuable command errors are reported through callbacks', () => {
  const waitSlot = readFileSync(join(MODULE_ROOT, 'motion', 'internal', 'single-wait-slot.ts'), 'utf8')
  assert.match(waitSlot, /wait\([\s\S]*?\): boolean/, 'SingleWaitSlot.wait should report slot acquisition')
  assert.doesNotMatch(
    waitSlot,
    /throw new Error\('wait slot is already in use'\)/,
    'SingleWaitSlot should not throw for a continuable busy state',
  )

  const protocolSources = [
    join(MODULE_ROOT, 'motion', 'protocols', 'dynamixel.ts'),
    join(MODULE_ROOT, 'motion', 'protocols', 'rs30x.ts'),
    join(MODULE_ROOT, 'motion', 'protocols', 'scservo.ts'),
  ]

  for (const sourcePath of protocolSources) {
    const source = readFileSync(sourcePath, 'utf8')
    assert.match(source, /const COMMAND_BUSY_ERROR = 'command is already waiting for response'/)
    assert.match(source, /#dispatchCommand\(/, `${sourcePath} should define dispatch command paths`)
    assert.doesNotMatch(
      source,
      /throw new Error\('command is already waiting for response'\)/,
      `${sourcePath} should not throw for command busy states`,
    )
    assert.match(source, /onError\(new Error\(COMMAND_BUSY_ERROR\)\)/)
  }
})

test('motion duration units are converted at driver protocol boundaries', () => {
  const controller = readFileSync(join(MODULE_ROOT, 'motion', 'motion-controller.ts'), 'utf8')
  const rs30xDriver = readFileSync(join(MODULE_ROOT, 'motion', 'rs30x-driver.ts'), 'utf8')
  const scservoDriver = readFileSync(join(MODULE_ROOT, 'motion', 'scservo-driver.ts'), 'utf8')
  const m5stackchanDriver = readFileSync(join(MODULE_ROOT, 'motion', 'm5stackchan-servo-driver.ts'), 'utf8')
  const sg90Driver = readFileSync(join(MODULE_ROOT, 'motion', 'sg90-driver.ts'), 'utf8')
  const dynamixelDriver = readFileSync(join(MODULE_ROOT, 'motion', 'dynamixel-driver.ts'), 'utf8')
  const rs30xProtocol = readFileSync(join(MODULE_ROOT, 'motion', 'protocols', 'rs30x.ts'), 'utf8')
  const scservoProtocol = readFileSync(join(MODULE_ROOT, 'motion', 'protocols', 'scservo.ts'), 'utf8')

  assert.match(controller, /export type MotionDurationSeconds = number/)
  assert.match(controller, /export type ServoGoalTimeMilliseconds = number/)
  assert.match(controller, /export type ServoGoalTimeCentiseconds = number/)
  assert.match(controller, /motionDurationSecondsToMilliseconds/)
  assert.match(controller, /motionDurationSecondsToCentiseconds/)
  assert.match(rs30xDriver, /motionDurationSecondsToCentiseconds\(time\)/)
  assert.match(rs30xDriver, /goalTimeCentiseconds/)
  assert.match(scservoDriver, /motionDurationSecondsToMilliseconds\(time\)/)
  assert.match(scservoDriver, /goalTimeMilliseconds/)
  assert.match(m5stackchanDriver, /motionDurationSecondsToMilliseconds\(time\)/)
  assert.match(m5stackchanDriver, /goalTimeMilliseconds/)
  assert.match(sg90Driver, /motionDurationSecondsToMilliseconds\(time\) \/ INTERVAL/)
  assert.match(dynamixelDriver, /_time: MotionDurationSeconds/)
  assert.match(rs30xProtocol, /export type RS30XGoalTimeCentiseconds = number/)
  assert.match(rs30xProtocol, /goalTimeCentiseconds: RS30XGoalTimeCentiseconds/)
  assert.doesNotMatch(rs30xProtocol, /goalTime\s*\*\s*100/)
  assert.match(scservoProtocol, /export type SCServoGoalTimeMilliseconds = number/)
  assert.match(scservoProtocol, /goalTimeMilliseconds: SCServoGoalTimeMilliseconds/)
  assert.doesNotMatch(rs30xDriver, /setAngleInTime\([^,\n]+,\s*time[,)]/)
  assert.doesNotMatch(scservoDriver, /setAngleInTime\([^,\n]+,\s*time \* 1000/)
  assert.doesNotMatch(m5stackchanDriver, /setRawPositionInTime\([^,\n]+,\s*time \* 1000/)
})

test('optional PY32 hardware initialization is reported without making consumers throw', () => {
  const expander = readFileSync(join(MODULE_ROOT, 'io-expander', 'py32-io-expander.ts'), 'utf8')
  const motionManifest = readJson(join(MODULE_ROOT, 'motion', 'manifest.json'))
  const lightingManifest = readJson(join(MODULE_ROOT, 'lighting', 'manifest.json'))

  assert.ok(motionManifest.include.includes('../io-expander/manifest.json'))
  assert.ok(!motionManifest.include.includes('../lighting/manifest.json'))
  assert.ok(lightingManifest.include.includes('../io-expander/manifest.json'))
  assert.match(expander, /export function tryGetSharedPY32IOExpander/)
  assert.match(expander, /onError\?\.\(error\)/)

  const py32Led = readFileSync(join(MODULE_ROOT, 'lighting', 'py32-led.ts'), 'utf8')
  assert.match(py32Led, /tryGetSharedPY32IOExpander/)
  assert.doesNotMatch(py32Led, /getSharedPY32IOExpander\(/)
  assert.match(py32Led, /if \(!expander\) return/)

  const m5stackchanServo = readFileSync(join(MODULE_ROOT, 'motion', 'm5stackchan-servo-driver.ts'), 'utf8')
  assert.match(m5stackchanServo, /tryGetSharedPY32IOExpander/)
  assert.doesNotMatch(m5stackchanServo, /getSharedPY32IOExpander\(/)
  assert.match(m5stackchanServo, /if \(!expander\) return/)
})

test('runtime state machines keep internal state as numeric constants', () => {
  const stateSources = [
    join(MODULE_ROOT, 'conversation', 'chat-state.ts'),
    join(MODULE_ROOT, 'connectivity', 'network-state.ts'),
    join(MODULE_ROOT, 'input', 'touch-panel-gesture.ts'),
    join(MODULE_ROOT, 'ui', 'components', 'status-bar', 'chat-status-bar.ts'),
    join(MODULE_ROOT, 'ui', 'views', 'settings', 'settings-view.ts'),
  ]

  for (const sourcePath of stateSources) {
    const source = readFileSync(sourcePath, 'utf8')
    assert.match(source, /Object\.freeze\(\{/, `${sourcePath} should define numeric state constants`)
    assert.doesNotMatch(source, /#state[^=\n]*=\s*['"]/, `${sourcePath} should not store string state`)
    assert.doesNotMatch(
      source,
      /type\s+(?:ChatState|NetworkConnectionState|TouchState|ChatStatusBarState)\s*=\s*\|?\s*['"]/,
      `${sourcePath} should not model runtime state as a string union`,
    )
  }

  const settings = readFileSync(join(MODULE_ROOT, 'ui', 'views', 'settings', 'settings-view.ts'), 'utf8')
  assert.match(settings, /ble: SettingsStatusValue/, 'settings BLE status should be numeric')
  assert.match(settings, /wifi: SettingsStatusValue/, 'settings Wi-Fi status should be numeric')
  assert.match(settings, /settingsStatusToLabel/, 'settings labels should convert status at the UI boundary')
})

test('UI palette state stays numeric and converts colors at Piu render boundaries', () => {
  const colorStateSources = [
    join(MODULE_ROOT, 'ui', 'components', 'effects', 'emoticon.ts'),
    join(MODULE_ROOT, 'ui', 'components', 'face', 'parts', 'mouth.ts'),
    join(MODULE_ROOT, 'ui', 'components', 'face', 'parts', 'dog', 'eyebrow.ts'),
    join(MODULE_ROOT, 'ui', 'components', 'face', 'parts', 'dog', 'mouth.ts'),
    join(MODULE_ROOT, 'ui', 'components', 'face', 'parts', 'dog', 'nose.ts'),
  ]

  for (const sourcePath of colorStateSources) {
    const source = readFileSync(sourcePath, 'utf8')
    assert.doesNotMatch(
      source,
      /#(?:primary|secondary)[^=\n]*=\s*(?:colorString|toColorString)\(/,
      `${sourcePath} should not store converted color strings`,
    )
    assert.doesNotMatch(
      source,
      /const next(?:Primary|Secondary)\s*=\s*(?:colorString|toColorString)\(/,
      `${sourcePath} should compare numeric color state before rendering`,
    )
    assert.doesNotMatch(
      source,
      /#(?:primary|secondary)\s*:\s*string\b/,
      `${sourcePath} should type palette state as numeric color values`,
    )
  }

  const emoticon = readFileSync(join(MODULE_ROOT, 'ui', 'components', 'effects', 'emoticon.ts'), 'utf8')
  assert.match(emoticon, /function primaryColor\(face\?: FaceState\): number/)
  assert.match(emoticon, /function secondaryColor\(face\?: FaceState\): number/)
  assert.match(emoticon, /function drawSpriteCell\([^)]*color: number/)
  assert.match(emoticon, /drawTexture\(\s*getEmoticonTexture\(\),\s*colorString\(color\)/)
})

test('shared fakes live in modules/testing and module-local fakes stay under module tests', () => {
  assert.ok(existsSync(join(MODULE_ROOT, 'testing/fakes/ChatAudioIO.js')))
  assert.ok(existsSync(join(MODULE_ROOT, 'testing/fakes/timer.ts')))

  const fakePaths = walkFiles(MODULE_ROOT).filter((path) => path.includes(`${join('modules', 'testing', 'fakes')}`))
  assert.ok(fakePaths.length >= 2)

  const localFakePaths = walkFiles(MODULE_ROOT).filter((path) => path.includes(`${join('__tests__', 'fakes')}`))
  for (const path of localFakePaths) {
    assert.match(path, /host[/\\]modules[/\\][^/\\]+[/\\](?:.*[/\\])?__tests__[/\\]fakes[/\\]/)
  }
})

test('sample MOD manifests live under mods/examples', () => {
  const rootModManifests = readdirSync('mods', { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'examples')
    .map((entry) => join('mods', entry.name, 'manifest.json'))
    .filter(existsSync)

  assert.deepEqual(rootModManifests, [])

  const exampleManifests = readdirSync(join('mods', 'examples'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join('mods', 'examples', entry.name, 'manifest.json'))
    .filter(existsSync)

  assert.ok(exampleManifests.includes(join('mods', 'examples', 'look_around', 'manifest.json')))
  assert.ok(exampleManifests.includes(join('mods', 'examples', 'm5stackchan_smoke', 'manifest.json')))
})

test('sample MOD relative manifest includes resolve from examples directories', () => {
  const manifestPaths = walkFiles(join('mods', 'examples')).filter((path) => /manifest(?:\.test)?\.json$/.test(path))

  for (const manifestPath of manifestPaths) {
    const manifest = readJson(manifestPath)
    for (const includePath of manifest.include ?? []) {
      if (includePath.startsWith('.')) {
        assert.ok(
          existsSync(join(dirname(manifestPath), includePath)),
          `${manifestPath} includes missing ${includePath}`,
        )
      }
    }
  }
})

test('sample MOD sources import only public or sample-local modules', () => {
  const offenders = walkFiles(join('mods', 'examples'))
    .filter(isSourceFile)
    .flatMap((sourcePath) =>
      extractModuleSpecifiers(readFileSync(sourcePath, 'utf8'))
        .filter(isInternalModuleSpecifier)
        .map((specifier) => `${sourcePath}: ${specifier}`),
    )

  assert.deepEqual(offenders, [])
})

test('production manifests do not resolve test or architecture sources', () => {
  const offenders = PRODUCTION_MANIFEST_ROOTS.flatMap((root) => walkFiles(root))
    .filter(isProductionManifest)
    .flatMap((manifestPath) =>
      collectStringValues(readJson(manifestPath))
        .filter(isTestOrArchitectureTarget)
        .map((value) => `${manifestPath}: ${value}`),
    )

  assert.deepEqual(offenders, [])
})

test('Node unit test tsconfig discovers host tests by glob and excludes Moddable test entries', () => {
  const tsconfig = readJson('tsconfig.test.json')

  assert.deepEqual(tsconfig.include, ['host/**/*.test.ts'])
  assert.deepEqual(tsconfig.exclude, ['host/**/__tests__/*/*.test.ts'])

  const manifestTestSources = walkFiles('host')
    .filter((path) => path.endsWith('.test.ts'))
    .filter((path) => existsSync(join(dirname(path), 'manifest.test.json')))

  assert.ok(manifestTestSources.length > 0, 'Moddable manifest tests should exist')
  for (const testPath of manifestTestSources) {
    assert.match(
      testPath,
      /[/\\]__tests__[/\\][^/\\]+[/\\][^/\\]+\.test\.ts$/,
      `${testPath} should match the tsconfig.test.json Moddable exclude pattern`,
    )
  }
})

test('module Moddable test manifests include implementation and testing manifests', () => {
  const testingManifestPath = join(MODULE_ROOT, 'testing', 'manifest.json')
  const manifestPaths = walkFiles(MODULE_ROOT).filter((path) => path.endsWith('manifest.test.json'))

  for (const manifestPath of manifestPaths) {
    const manifest = readJson(manifestPath)
    const resolvedIncludes = (manifest.include ?? [])
      .filter((includePath: string) => includePath.startsWith('.'))
      .map((includePath: string) => join(dirname(manifestPath), includePath))

    assert.ok(resolvedIncludes.includes(testingManifestPath), `${manifestPath} should include testing manifest`)
    assert.ok(
      resolvedIncludes.some(
        (includePath: string) => includePath.endsWith('manifest.json') && includePath !== testingManifestPath,
      ),
      `${manifestPath} should include the implementation manifest under test`,
    )
  }
})

test('Moddable test manifests use local test modules as main entries', () => {
  const manifestPaths = walkFiles(MODULE_ROOT).filter((path) => path.endsWith('manifest.test.json'))

  for (const manifestPath of manifestPaths) {
    const manifest = readJson(manifestPath)
    const mainEntry = manifest.modules?.main
    assert.equal(typeof mainEntry, 'string', `${manifestPath} should define modules.main`)

    assert.match(mainEntry, /^\.\/[^/]+\.test$/, `${manifestPath} should use a local *.test module`)
    assert.ok(
      existsSync(join(dirname(manifestPath), `${mainEntry.slice(2)}.ts`)) ||
        existsSync(join(dirname(manifestPath), `${mainEntry.slice(2)}.js`)),
      `${manifestPath} should point to an existing local test file`,
    )
  }
})

test('Moddable test main entries trace ok and avoid not ok status strings', () => {
  const manifestPaths = walkFiles(MODULE_ROOT).filter((path) => path.endsWith('manifest.test.json'))

  for (const manifestPath of manifestPaths) {
    const manifest = readJson(manifestPath)
    const mainEntry = manifest.modules?.main
    assert.equal(typeof mainEntry, 'string', `${manifestPath} should define modules.main`)

    const testFile = existsSync(join(dirname(manifestPath), `${mainEntry.slice(2)}.ts`))
      ? join(dirname(manifestPath), `${mainEntry.slice(2)}.ts`)
      : join(dirname(manifestPath), `${mainEntry.slice(2)}.js`)
    const source = readFileSync(testFile, 'utf8')

    assert.match(source, /trace\(['"]ok\\n['"]\)/, `${testFile} should trace ok on success`)
    assert.doesNotMatch(source, /not ok/, `${testFile} should not use not ok for failure status`)
  }
})

test('UI views own Moddable test manifests under their view directories', () => {
  const viewsRoot = join(MODULE_ROOT, 'ui', 'views')
  const viewNames = readdirSync(viewsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)

  for (const viewName of viewNames) {
    const testRoot = join(viewsRoot, viewName, '__tests__')
    assert.ok(existsSync(testRoot), `${viewName} should have view-local Moddable tests`)

    const manifestPaths = walkFiles(testRoot).filter((path) => path.endsWith('manifest.test.json'))
    assert.ok(manifestPaths.length > 0, `${viewName} should have a manifest.test.json`)

    for (const manifestPath of manifestPaths) {
      const manifest = readJson(manifestPath)
      assert.ok(manifest.include.includes('../../../../manifest.json'), `${manifestPath} should include UI manifest`)
      assert.ok(
        manifest.include.includes('../../../../../testing/manifest.json'),
        `${manifestPath} should include testing manifest`,
      )
    }
  }
})
