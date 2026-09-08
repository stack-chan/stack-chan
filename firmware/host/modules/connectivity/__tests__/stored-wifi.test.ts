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

function installBareSpecifierPackages(): void {
  const modulesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const hostRoot = resolve(modulesRoot, '..')
  writeAliasPackage(modulesRoot, 'consts', resolve(modulesRoot, 'preferences/consts.js'))
  writeAliasPackageSubpath(
    modulesRoot,
    'stackchan',
    'settings-schema',
    resolve(modulesRoot, '../../sdk/settings-schema.js'),
  )
  writeAliasPackage(modulesRoot, 'settings-service', resolve(modulesRoot, 'preferences/settings-service.js'))
  writeAliasPackageSubpath(modulesRoot, 'stackchan', 'errors', resolve(modulesRoot, '../../sdk/errors.js'))
  writeAliasPackage(
    modulesRoot,
    'local-peer-capability',
    resolve(modulesRoot, 'connectivity/sim/local-peer-capability.js'),
  )
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
  writeAliasPackage(
    hostRoot,
    'local-peer-capability',
    resolve(modulesRoot, 'connectivity/sim/local-peer-capability.js'),
  )
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
  const [
    { clearStoredWiFiCredentials, connectStoredWiFi, stopStoredWiFiConnection },
    networkManager,
    preference,
    mcConfig,
  ] = await Promise.all([
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
  return {
    clearStoredWiFiCredentials,
    connectStoredWiFi,
    stopStoredWiFiConnection,
    networkManager,
    preference,
    traces,
  }
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
