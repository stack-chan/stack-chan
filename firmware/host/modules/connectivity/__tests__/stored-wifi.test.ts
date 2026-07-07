import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { writeAliasPackage, writeAliasPackageSubpath } from '../../testing/node-alias-package.js'

type FakeNetworkManager = {
  completeLastConnection(): void
  failLastConnection(reason?: string): void
  getStartedConnections(): Array<{ ssid: string; password: string; scanBeforeConnect?: boolean }>
  getStopCount(): number
  resetNetworkManager(): void
}

type FakePreference = {
  resetPreference(values?: Record<string, unknown>): void
}

type FakeConfig = {
  resetConfig(values?: Record<string, unknown>): void
}

function credentials(
  connections: Array<{ ssid: string; password: string; scanBeforeConnect?: boolean }>,
): Array<{ ssid: string; password: string }> {
  return connections.map(({ ssid, password }) => ({ ssid, password }))
}

function installBareSpecifierPackages(): void {
  const modulesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const hostRoot = resolve(modulesRoot, '..')
  writeAliasPackage(modulesRoot, 'consts', resolve(modulesRoot, 'preferences/consts.js'))
  writeAliasPackage(
    modulesRoot,
    'network-manager',
    resolve(modulesRoot, 'connectivity/__tests__/fakes/network-manager.js'),
  )
  writeAliasPackage(modulesRoot, 'preference', resolve(modulesRoot, 'testing/fakes/preference.js'), {
    hasDefaultExport: true,
  })
  writeAliasPackage(modulesRoot, 'stored-wifi', resolve(modulesRoot, 'connectivity/stored-wifi.js'))
  writeAliasPackage(modulesRoot, 'timer', resolve(modulesRoot, 'testing/fakes/timer.js'), { hasDefaultExport: true })
  writeAliasPackage(modulesRoot, 'mac-address', resolve(modulesRoot, 'util/sim/mac-address.js'), {
    hasDefaultExport: true,
  })
  writeAliasPackage(hostRoot, 'stackchan-util', resolve(modulesRoot, 'util/stackchan-util.js'))
  writeAliasPackage(hostRoot, 'boot-network-recovery', resolve(hostRoot, 'app/boot-network-recovery.js'))
  writeAliasPackageSubpath(modulesRoot, 'mc', 'config', resolve(modulesRoot, 'testing/fakes/mc-config.js'), {
    hasDefaultExport: true,
  })
  writeAliasPackageSubpath(hostRoot, 'mc', 'config', resolve(modulesRoot, 'testing/fakes/mc-config.js'), {
    hasDefaultExport: true,
  })
  writeAliasPackage(hostRoot, 'stored-wifi', resolve(modulesRoot, 'connectivity/stored-wifi.js'))
}

async function setup(values: Record<string, unknown> = {}, configValues: Record<string, unknown> = {}) {
  installBareSpecifierPackages()
  const [{ connectStoredWiFi, stopStoredWiFiConnection }, networkManager, preference, mcConfig] = await Promise.all([
    import('../stored-wifi.js'),
    import('./fakes/network-manager.js') as Promise<FakeNetworkManager>,
    import('../../testing/fakes/preference.js') as Promise<FakePreference>,
    import('../../testing/fakes/mc-config.js') as Promise<FakeConfig>,
  ])
  const traces: string[] = []
  ;(globalThis as typeof globalThis & { trace: (...messages: unknown[]) => void }).trace = (...messages) => {
    traces.push(messages.map(String).join(''))
  }
  networkManager.resetNetworkManager()
  preference.resetPreference(values)
  mcConfig.resetConfig(configValues)
  return { connectStoredWiFi, stopStoredWiFiConnection, networkManager, preference, traces }
}

test('connectStoredWiFi starts a network connection from stored preferences', async () => {
  const { connectStoredWiFi, networkManager } = await setup({
    'wifi.ssid': 'stackchan-ap',
    'wifi.password': 'secret',
  })

  assert.equal(connectStoredWiFi(), true)
  assert.deepEqual(networkManager.getStartedConnections(), [{ ssid: 'stackchan-ap', password: 'secret' }])
})

test('connectStoredWiFi does not start a network connection without stored SSID', async () => {
  const { connectStoredWiFi, networkManager, traces } = await setup({
    'wifi.password': 'secret',
  })

  assert.equal(connectStoredWiFi(), false)
  assert.deepEqual(networkManager.getStartedConnections(), [])
  assert.ok(traces.includes('No Wi-Fi SSID\n'))
})

test('connectStoredWiFi accepts settings-screen credential overrides', async () => {
  const { connectStoredWiFi, stopStoredWiFiConnection, networkManager } = await setup()

  assert.equal(connectStoredWiFi({ ssid: 'settings-ap', password: 'settings-secret' }), true)
  stopStoredWiFiConnection()

  assert.deepEqual(networkManager.getStartedConnections(), [{ ssid: 'settings-ap', password: 'settings-secret' }])
  assert.equal(networkManager.getStopCount(), 1)
})

test('startHostBootServices starts stored Wi-Fi with scan before connect when host boot services are explicitly started', async () => {
  const { networkManager, preference } = await setup({
    'wifi.ssid': 'boot-ap',
    'wifi.password': 'boot-secret',
  })
  const { startHostBootServices } = await import('../../../app/boot-services.js')

  preference.resetPreference({
    'wifi.ssid': 'boot-ap',
    'wifi.password': 'boot-secret',
  })
  networkManager.resetNetworkManager()
  const services = startHostBootServices()

  assert.deepEqual(credentials(networkManager.getStartedConnections()), [{ ssid: 'boot-ap', password: 'boot-secret' }])
  assert.equal(networkManager.getStartedConnections()[0]?.scanBeforeConnect, true)
  networkManager.completeLastConnection()
  assert.deepEqual(await services.connectivity.network?.ready, { status: 'connected' })
})

test('startHostBootServices ignores root mc config Wi-Fi credentials reserved for Moddable setup', async () => {
  const { networkManager } = await setup({}, { ssid: 'config-ap', password: 'config-secret' })
  const { startHostBootServices } = await import('../../../app/boot-services.js')

  const services = startHostBootServices()

  assert.deepEqual(credentials(networkManager.getStartedConnections()), [])
  assert.deepEqual(await services.connectivity.network?.ready, {
    status: 'skipped',
    reason: 'missing Wi-Fi credentials',
  })
})

test('startHostBootServices accepts nested mc config Wi-Fi credentials for compatibility', async () => {
  const { networkManager } = await setup({}, { wifi: { ssid: 'nested-ap', password: 'nested-secret' } })
  const { startHostBootServices } = await import('../../../app/boot-services.js')

  const services = startHostBootServices()

  assert.deepEqual(credentials(networkManager.getStartedConnections()), [
    { ssid: 'nested-ap', password: 'nested-secret' },
  ])
  networkManager.completeLastConnection()
  assert.deepEqual(await services.connectivity.network?.ready, { status: 'connected' })
})

test('startHostBootServices starts Wi-Fi with ChatAudioIO config present', async () => {
  const { networkManager } = await setup(
    {},
    {
      wifi: { ssid: 'config-ap', password: 'config-secret' },
      chat: { type: 'openAIRealtime' },
    },
  )
  const { startHostBootServices } = await import('../../../app/boot-services.js')

  const services = startHostBootServices()

  assert.deepEqual(credentials(networkManager.getStartedConnections()), [
    { ssid: 'config-ap', password: 'config-secret' },
  ])
  networkManager.completeLastConnection()
  assert.deepEqual(await services.connectivity.network?.ready, { status: 'connected' })
})

test('startHostBootServices exposes skipped network readiness when Wi-Fi credentials are unavailable', async () => {
  const { networkManager, traces } = await setup()
  const { startHostBootServices } = await import('../../../app/boot-services.js')

  const services = startHostBootServices()

  assert.deepEqual(networkManager.getStartedConnections(), [])
  assert.deepEqual(await services.connectivity.network?.ready, {
    status: 'skipped',
    reason: 'missing Wi-Fi credentials',
  })
  assert.ok(traces.includes('No Wi-Fi SSID\n'))
})

test('startHostBootServices exposes failed network readiness with a traceable reason', async () => {
  const { networkManager, traces } = await setup({
    'wifi.ssid': 'boot-ap',
    'wifi.password': 'bad-secret',
  })
  const { startHostBootServices } = await import('../../../app/boot-services.js')

  const services = startHostBootServices({ wifi: { maxAttempts: 1 } })
  networkManager.failLastConnection('authentication failed')

  assert.deepEqual(await services.connectivity.network?.ready, {
    status: 'failed',
    reason: 'authentication failed',
  })
  assert.ok(traces.includes('[network] connection failed: authentication failed\n'))
})
