import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { writeAliasPackage, writeAliasPackageSubpath } from '../../testing/node-alias-package.js'
import FakeWiFi, { getFakeWiFiInstances, resetFakeWiFi } from './fakes/ecma-wifi.js'
import SNTP, { resetSNTP } from './fakes/sntp.js'

function installBareSpecifierPackages(): void {
  const modulesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
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

async function setup(configValues: Record<string, unknown> = {}) {
  installBareSpecifierPackages()
  resetFakeWiFi()
  resetSNTP()
  const [networkService, mcConfig, timer, time] = await Promise.all([
    import('../network-service.js'),
    import('../../testing/fakes/mc-config.js'),
    import('../../testing/fakes/timer.js'),
    import('../../testing/fakes/time.js'),
  ])
  mcConfig.resetConfig(configValues)
  timer.default.reset()
  time.default.reset()
  const traces: string[] = []
  ;(globalThis as typeof globalThis & { trace: (...messages: unknown[]) => void }).trace = (...messages) => {
    traces.push(messages.map(String).join(''))
  }
  return { NetworkService: networkService.NetworkService, traces, timer: timer.default, time: time.default }
}

test('NetworkService connects through ECMA-419 Wi-Fi and resolves after IP address', async () => {
  const { NetworkService } = await setup()
  let connected = false
  const service = new NetworkService({ ssid: 'stackchan-ap', password: 'secret' })

  service.connect(() => {
    connected = true
  })

  assert.deepEqual(getFakeWiFiInstances()[0]?.connectOptions, {
    SSID: 'stackchan-ap',
    password: 'secret',
    secure: true,
  })
  getFakeWiFiInstances()[0]?.emitGotIP('192.0.2.20')
  assert.equal(connected, true)
  service.close()
})

test('NetworkService synchronizes time after IP when sntp is configured', async () => {
  const { NetworkService, time } = await setup({ sntp: 'pool.ntp.org' })
  const service = new NetworkService({ ssid: 'stackchan-ap', password: 'secret' })
  const originalNow = Date.now
  Date.now = () => 0

  try {
    service.connect()
    getFakeWiFiInstances()[0]?.emitGotIP()

    assert.deepEqual(SNTP.requests, [{ host: 'pool.ntp.org' }])
    assert.equal(time.ticks, SNTP.nextTime)
    service.close()
  } finally {
    Date.now = originalNow
  }
})

test('NetworkService scanAndConnect connects when the target access point is found', async () => {
  const { NetworkService } = await setup()
  FakeWiFi.scanResults = [{ ssid: 'other-ap' }, { ssid: 'stackchan-ap' }]
  let connected = false
  const service = new NetworkService({ ssid: 'stackchan-ap', password: 'secret' })

  service.scanAndConnect(() => {
    connected = true
  })
  getFakeWiFiInstances()[0]?.emitGotIP()

  assert.equal(connected, true)
  assert.equal(getFakeWiFiInstances()[0]?.connectOptions?.SSID, 'stackchan-ap')
  service.close()
})
