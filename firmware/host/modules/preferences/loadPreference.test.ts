import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { DOMAIN } from '../../../sdk/settings-schema.js'
import { writeAliasPackage, writeAliasPackageSubpath } from '../testing/node-alias-package.js'

type FakeConfig = {
  resetConfig(values?: Record<string, unknown>): void
}

type FakeModules = {
  resetModules(values?: Record<string, unknown>, archive?: string[]): void
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
  writeAliasPackageSubpath(
    modulesRoot,
    'stackchan',
    'settings-schema',
    resolve(modulesRoot, '../../sdk/settings-schema.js'),
  )
  writeAliasPackage(modulesRoot, 'settings-service', resolve(modulesRoot, 'preferences/settings-service.js'))
  writeAliasPackageSubpath(
    modulesRoot,
    'stackchan-contracts',
    'mod-package',
    resolve(modulesRoot, '../../contracts/mod-package.js'),
  )
  writeAliasPackage(modulesRoot, 'installed-mod', resolve(modulesRoot, 'mod-package/installed-mod.js'), {
    hasDefaultExport: true,
  })
  writeAliasPackage(modulesRoot, 'Resource', resolve(modulesRoot, 'testing/fakes/resource.js'), {
    hasDefaultExport: true,
  })
  writeAliasPackageSubpath(modulesRoot, 'text', 'decoder', resolve(modulesRoot, 'testing/fakes/text-decoder.js'), {
    hasDefaultExport: true,
  })
  writeAliasPackageSubpath(modulesRoot, 'stackchan', 'errors', resolve(modulesRoot, '../../sdk/errors.js'))
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
  ArrayBuffer.fromString = (value) => new TextEncoder().encode(value).buffer
  String.fromArrayBuffer = (value) => new TextDecoder().decode(value)
  installBareSpecifierPackages()
  const [modules, config, preference, loadPreference, resources] = await Promise.all([
    import('../testing/fakes/modules.js') as Promise<FakeModules>,
    import('../testing/fakes/mc-config.js') as Promise<FakeConfig>,
    import('../testing/fakes/preference.js') as Promise<FakePreference>,
    import('./loadPreference.js'),
    import('../testing/fakes/resource.js'),
    import('../testing/fakes/text-decoder.js'),
  ])
  const traces: string[] = []
  ;(globalThis as typeof globalThis & { trace: (...messages: unknown[]) => void }).trace = (...messages) => {
    traces.push(messages.map(String).join(''))
  }
  modules.resetModules()
  resources.resetResources()
  config.resetConfig({ ui: { type: 'simple' } })
  preference.resetPreference()
  return { loadPreferences: loadPreference.default, modules, config, preference, traces, resources }
}

test('loadPreferences ignores a retired renderer.type without copying it to ui.type', async () => {
  const { loadPreferences, preference, traces } = await setup()
  preference.resetPreference({
    'renderer.type': 'dog',
  })

  assert.equal(loadPreferences(DOMAIN.ui).type, 'simple')
  assert.equal(loadPreferences(DOMAIN.ui).type, 'simple')
  assert.equal(preference.default.get(DOMAIN.ui, 'type'), undefined)
  assert.equal(preference.default.get('renderer', 'type'), 'dog')
  assert.deepEqual(traces, [])
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
  assert.deepEqual(traces, ['[settings] READ_ONLY driver.type (stored)\n'])
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

test('declared app defaults keep saved preferences and the hardware lock authoritative', async () => {
  const { modules, config, preference, resources } = await setup()
  let imports = 0
  modules.resetModules(
    {
      get mod() {
        imports++
        throw new Error('must not evaluate')
      },
    },
    ['mod'],
  )
  resources.resetResources({ 'stackchan-mod.json': declaration({ 'driver.type': 'scservo', 'tts.volume': 0.2 }) })
  config.resetConfig({ driver: { type: 'm5stackchan', typeLocked: true }, tts: { volume: 0.6 } })
  const fresh = await import(new URL('./loadPreference.js?declarative-defaults', import.meta.url).href)
  assert.equal(fresh.default(DOMAIN.driver).type, 'm5stackchan')
  assert.equal(fresh.default(DOMAIN.driver).typeLocked, true)
  assert.equal(fresh.default(DOMAIN.tts).volume, 0.2)
  preference.resetPreference({ 'tts.volume': '0.8' })
  assert.equal(fresh.default(DOMAIN.tts).volume, 0.8)
  assert.equal(imports, 0)
})

function declaration(settings: Record<string, unknown>): ArrayBuffer {
  return new TextEncoder().encode(
    JSON.stringify({
      format: 'tech.stackchan.mod',
      schemaVersion: 2,
      appApiVersion: 2,
      hostApiVersion: 9,
      id: 'tech.stackchan.settings-test',
      version: '1.0.0',
      targets: ['portable'],
      entrypoints: ['mod'],
      settings,
    }),
  ).buffer
}

test('invalid and retired app defaults fail before app evaluation and host recovery remains accessible', async () => {
  const { modules, resources } = await setup()
  modules.resetModules({}, ['mod'])
  for (const [index, settings] of [
    { 'renderer.type': 'dog' },
    { 'wifi.ssid': 'app-network' },
    { 'tts.volume': 'invalid' },
  ].entries()) {
    resources.resetResources({ 'stackchan-mod.json': declaration(settings) })
    const fresh = await import(new URL(`./loadPreference.js?invalid-defaults=${index}`, import.meta.url).href)
    assert.throws(() => fresh.default(DOMAIN.ui), { code: 'MOD_METADATA_INVALID' })
    assert.equal(fresh.getHostSettingsService().get('ui.type'), 'simple')
  }
})

test('loadPreferences reads the MCP authentication token from preferences', async () => {
  const { loadPreferences, preference } = await setup()
  preference.resetPreference({
    'mcp.token': 'secret-token',
  })

  assert.equal(loadPreferences(DOMAIN.mcp).token, 'secret-token')
})

test('loadPreferences reads the selected time zone from preferences', async () => {
  const { loadPreferences, preference } = await setup()
  preference.resetPreference({
    'time.timezone': 'london',
  })

  assert.equal(loadPreferences(DOMAIN.time).timezone, 'london')
})

test('host startup settings can be read and written without evaluating MOD configuration', async () => {
  const { modules, config, preference } = await setup()
  let evaluations = 0
  modules.resetModules({
    get 'mod/config'() {
      evaluations++
      throw new Error('broken app configuration')
    },
  })
  config.resetConfig({ ui: { language: 'en' }, time: { timezone: 'tokyo' } })
  preference.resetPreference({ 'ui.language': 'ja', 'wifi.ssid': 'saved-network' })
  const { getHostSettingsService } = await import('./loadPreference.js')
  const settings = getHostSettingsService()
  assert.equal(settings.get('ui.language'), 'ja')
  assert.equal(settings.domain('wifi').ssid, 'saved-network')
  assert.equal(settings.domain('time').timezone, 'tokyo')
  settings.write({ 'ui.language': 'en' })
  assert.equal(preference.default.get('ui', 'language'), 'en')
  assert.equal(evaluations, 0)
})
