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
    const mainEntries = manifest.modules?.['*']
    if (!mainEntries) continue

    for (const entry of Array.isArray(mainEntries) ? mainEntries : [mainEntries]) {
      assert.match(entry, /^\.\/[^/]+\.test$/, `${manifestPath} should use a local *.test module`)
      assert.ok(
        existsSync(join(dirname(manifestPath), `${entry.slice(2)}.ts`)) ||
          existsSync(join(dirname(manifestPath), `${entry.slice(2)}.js`)),
        `${manifestPath} should point to an existing local test file`,
      )
    }
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
