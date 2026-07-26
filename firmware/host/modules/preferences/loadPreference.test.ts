import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { writeAliasPackage, writeAliasPackageSubpath } from '../testing/node-alias-package.js'
import { DOMAIN } from './consts.js'

type FakeConfig = {
  resetConfig(values?: Record<string, unknown>): void
}

type FakeModules = {
  resetModules(values?: Record<string, unknown>): void
}

type FakePreference = {
  resetPreference(values?: Record<string, unknown>): void
  default: {
    get(domain: string, name: string): unknown
  }
}

function installBareSpecifierPackages(): void {
  const modulesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  writeAliasPackage(modulesRoot, 'consts', resolve(modulesRoot, 'preferences/consts.js'))
  writeAliasPackage(modulesRoot, 'modules', resolve(modulesRoot, 'testing/fakes/modules.js'), {
    hasDefaultExport: true,
  })
  writeAliasPackage(modulesRoot, 'preference', resolve(modulesRoot, 'testing/fakes/preference.js'), {
    hasDefaultExport: true,
  })
  writeAliasPackage(modulesRoot, 'structuredClone', resolve(modulesRoot, 'testing/fakes/structured-clone.js'), {
    hasDefaultExport: true,
  })
  writeAliasPackageSubpath(modulesRoot, 'mc', 'config', resolve(modulesRoot, 'testing/fakes/mc-config.js'), {
    hasDefaultExport: true,
  })
}

async function setup() {
  installBareSpecifierPackages()
  const [modules, config, preference, loadPreference] = await Promise.all([
    import('../testing/fakes/modules.js') as Promise<FakeModules>,
    import('../testing/fakes/mc-config.js') as Promise<FakeConfig>,
    import('../testing/fakes/preference.js') as Promise<FakePreference>,
    import('./loadPreference.js'),
  ])
  const traces: string[] = []
  ;(globalThis as typeof globalThis & { trace: (...messages: unknown[]) => void }).trace = (...messages) => {
    traces.push(messages.map(String).join(''))
  }
  modules.resetModules()
  config.resetConfig({ ui: { type: 'simple' } })
  preference.resetPreference()
  return { loadPreferences: loadPreference.default, modules, config, preference, traces }
}

test('loadPreferences migrates legacy renderer.type to ui.type when ui.type is absent', async () => {
  const { loadPreferences, preference } = await setup()
  preference.resetPreference({
    'renderer.type': 'dog',
  })

  assert.equal(loadPreferences(DOMAIN.ui).type, 'dog')
  assert.equal(preference.default.get(DOMAIN.ui, 'type'), 'dog')
})

test('loadPreferences traces legacy renderer migration only once after canonical write-back', async () => {
  const { loadPreferences, preference, traces } = await setup()
  preference.resetPreference({
    'renderer.type': 'dog',
  })

  assert.equal(loadPreferences(DOMAIN.ui).type, 'dog')
  assert.equal(loadPreferences(DOMAIN.ui).type, 'dog')
  assert.deepEqual(traces, ['[preferences] migrated renderer.type to ui.type\n'])
})

test('loadPreferences keeps explicit ui.type when legacy renderer.type also exists', async () => {
  const { loadPreferences, preference } = await setup()
  preference.resetPreference({
    'ui.type': 'simple',
    'renderer.type': 'dog',
  })

  assert.equal(loadPreferences(DOMAIN.ui).type, 'simple')
  assert.equal(preference.default.get(DOMAIN.ui, 'type'), 'simple')
})

test('loadPreferences ignores a stored driver type when the platform locks its driver', async () => {
  const { loadPreferences, config, preference, traces } = await setup()
  config.resetConfig({
    driver: { type: 'm5stackchan', typeLocked: true },
  })
  preference.resetPreference({
    'driver.type': 'scservo',
  })

  const driver = loadPreferences(DOMAIN.driver)

  assert.equal(driver.type, 'm5stackchan')
  assert.equal(driver.typeLocked, true)
  assert.deepEqual(traces, ['[preferences] ignored stored driver.type=scservo; platform locks it to m5stackchan\n'])
})

test('loadPreferences keeps stored driver selection on an unlocked platform', async () => {
  const { loadPreferences, config, preference } = await setup()
  config.resetConfig({
    driver: { type: 'm5stackchan' },
  })
  preference.resetPreference({
    'driver.type': 'scservo',
  })

  assert.equal(loadPreferences(DOMAIN.driver).type, 'scservo')
})

test('loadPreferences does not let MOD config relax a platform driver lock', async () => {
  const { modules, config } = await setup()
  modules.resetModules({
    'mod/config': { driver: { type: 'scservo', typeLocked: false } },
  })
  config.resetConfig({
    driver: { type: 'm5stackchan', typeLocked: true },
  })
  const freshModule = await import(new URL('./loadPreference.js?platform-lock', import.meta.url).href)

  const driver = freshModule.default(DOMAIN.driver)

  assert.equal(driver.type, 'm5stackchan')
  assert.equal(driver.typeLocked, true)
})

test('loadPreferences reads the MCP authentication token from preferences', async () => {
  const { loadPreferences, preference } = await setup()
  preference.resetPreference({
    'mcp.token': 'secret-token',
  })

  assert.equal(loadPreferences(DOMAIN.mcp).token, 'secret-token')
})
