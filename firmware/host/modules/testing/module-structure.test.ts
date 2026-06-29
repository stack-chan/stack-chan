import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

const MODULE_ROOT = 'host/modules'
const RUNTIME_MODULES = [
  'audio',
  'camera',
  'connectivity',
  'conversation',
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

test('runtime modules own implementation manifests and tests under host/modules', () => {
  for (const moduleName of RUNTIME_MODULES) {
    const moduleDir = join(MODULE_ROOT, moduleName)
    assert.ok(existsSync(join(moduleDir, 'manifest.json')), `${moduleName} should have manifest.json`)
    assert.ok(existsSync(join(moduleDir, 'manifest.test.json')), `${moduleName} should have manifest.test.json`)

    const files = walkFiles(moduleDir)
    assert.ok(
      files.some((path) => /(?:^|[/\\])[^/\\]+\.test\.(?:ts|js)$/.test(path)),
      `${moduleName} should own tests`,
    )
  }
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
    if (!mainEntry) continue
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
    if (!mainEntry) continue
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
