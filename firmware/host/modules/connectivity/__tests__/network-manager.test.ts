import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { writeAliasPackage, writeAliasPackageSubpath } from '../../testing/node-alias-package.js'
import { getFakeWiFiInstances, resetFakeWiFi } from './fakes/ecma-wifi.js'

function installBareSpecifierPackages(): void {
  const modulesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  writeAliasPackage(modulesRoot, 'network-service', resolve(modulesRoot, 'connectivity/network-service.js'))
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
  writeAliasPackage(modulesRoot, 'modules', resolve(modulesRoot, 'testing/fakes/modules.js'), {
    hasDefaultExport: true,
  })
  writeAliasPackageSubpath(modulesRoot, 'mc', 'config', resolve(modulesRoot, 'testing/fakes/mc-config.js'), {
    hasDefaultExport: true,
  })
}

async function setup() {
  installBareSpecifierPackages()
  resetFakeWiFi()
  const [{ startNetworkConnection, stopNetworkConnection }, mcConfig, timer] = await Promise.all([
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
  stopNetworkConnection()
  resetFakeWiFi()
  return { startNetworkConnection, stopNetworkConnection, traces }
}

test('startNetworkConnection reuses an active service for matching credentials', async () => {
  const { startNetworkConnection, stopNetworkConnection } = await setup()
  let connectedCount = 0

  const first = startNetworkConnection({
    ssid: 'stackchan-ap',
    password: 'secret',
    onConnected: () => {
      connectedCount += 1
    },
  })
  const second = startNetworkConnection({
    ssid: 'stackchan-ap',
    password: 'secret',
    onConnected: () => {
      connectedCount += 10
    },
  })

  assert.equal(first, second)
  assert.equal(getFakeWiFiInstances().length, 1)
  getFakeWiFiInstances()[0]?.emitGotIP()
  assert.equal(connectedCount, 11)
  stopNetworkConnection()
})

test('startNetworkConnection reconnects when credentials change', async () => {
  const { startNetworkConnection, stopNetworkConnection } = await setup()

  startNetworkConnection({ ssid: 'first-ap', password: 'first-secret' })
  const firstWiFi = getFakeWiFiInstances()[0]
  startNetworkConnection({ ssid: 'second-ap', password: 'second-secret' })

  assert.equal(firstWiFi?.closed, true)
  assert.equal(getFakeWiFiInstances().length, 2)
  assert.deepEqual(getFakeWiFiInstances()[1]?.connectOptions, {
    SSID: 'second-ap',
    password: 'second-secret',
    secure: true,
  })
  stopNetworkConnection()
})
