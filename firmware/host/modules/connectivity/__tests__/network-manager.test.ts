import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { writeAliasPackage, writeAliasPackageSubpath } from '../../testing/node-alias-package.js'
import { getFakeWiFiInstances, resetFakeWiFi } from './fakes/ecma-wifi.js'

function installBareSpecifierPackages(): void {
  const modulesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  writeAliasPackage(modulesRoot, 'network-service', resolve(modulesRoot, 'connectivity/network-service.js'))
  writeAliasPackage(modulesRoot, 'network-types', resolve(modulesRoot, 'connectivity/network-types.js'))
  writeAliasPackageSubpath(
    modulesRoot,
    'stackchan',
    'settings-schema',
    resolve(modulesRoot, '../../sdk/settings-schema.js'),
  )
  writeAliasPackageSubpath(modulesRoot, 'stackchan', 'errors', resolve(modulesRoot, '../../sdk/errors.js'))
  writeAliasPackage(modulesRoot, 'network-state', resolve(modulesRoot, 'connectivity/network-state.js'))
  writeAliasPackage(modulesRoot, 'sntp', resolve(modulesRoot, 'connectivity/__tests__/fakes/sntp.js'), {
    hasDefaultExport: true,
  })
  writeAliasPackage(modulesRoot, 'time', resolve(modulesRoot, 'testing/fakes/time.js'), {
    hasDefaultExport: true,
  })
  writeAliasPackage(modulesRoot, 'timer', resolve(modulesRoot, 'testing/fakes/timer.js'), {
    hasDefaultExport: true,
  })
  writeAliasPackage(modulesRoot, 'ecma-wifi', resolve(modulesRoot, 'connectivity/__tests__/fakes/ecma-wifi.js'), {
    hasDefaultExport: true,
  })
  writeAliasPackageSubpath(modulesRoot, 'mc', 'config', resolve(modulesRoot, 'testing/fakes/mc-config.js'), {
    hasDefaultExport: true,
  })
}

async function setup() {
  installBareSpecifierPackages()
  resetFakeWiFi()
  const [{ openNetworkConnection }, mcConfig, timer] = await Promise.all([
    import('../network-manager.js'),
    import('../../testing/fakes/mc-config.js'),
    import('../../testing/fakes/timer.js'),
  ])
  mcConfig.resetConfig()
  timer.default.reset()
  const traces: string[] = []
  ;(globalThis as typeof globalThis & { trace: (...messages: unknown[]) => void }).trace = (...messages) => {
    traces.push(messages.map(String).join(''))
  }
  return { openNetworkConnection, traces }
}

test('openNetworkConnection reuses an active service for matching credentials', async () => {
  const { openNetworkConnection } = await setup()
  let connectedCount = 0

  const first = openNetworkConnection({
    ssid: 'stackchan-ap',
    password: 'secret',
    onConnected: () => {
      connectedCount += 1
    },
  })
  const second = openNetworkConnection({
    ssid: 'stackchan-ap',
    password: 'secret',
    onConnected: () => {
      connectedCount += 10
    },
  })

  assert.notEqual(first, second)
  assert.equal(getFakeWiFiInstances().length, 1)
  getFakeWiFiInstances()[0]?.emitGotIP()
  assert.equal(connectedCount, 11)
  first.close()
  assert.equal(getFakeWiFiInstances()[0]?.closed, false)
  second.close()
  assert.equal(getFakeWiFiInstances()[0]?.closed, true)
})

test('openNetworkConnection changes credentials only after the previous owner closes', async () => {
  const { openNetworkConnection } = await setup()

  const first = openNetworkConnection({ ssid: 'first-ap', password: 'first-secret' })
  const firstWiFi = getFakeWiFiInstances()[0]
  assert.throws(() => openNetworkConnection({ ssid: 'second-ap' }), { code: 'BUSY' })
  first.close()
  const second = openNetworkConnection({ ssid: 'second-ap', password: 'second-secret' })

  assert.equal(firstWiFi?.closed, true)
  assert.equal(getFakeWiFiInstances().length, 2)
  assert.deepEqual(getFakeWiFiInstances()[1]?.connectOptions, {
    SSID: 'second-ap',
    password: 'second-secret',
    secure: true,
  })
  second.close()
})
