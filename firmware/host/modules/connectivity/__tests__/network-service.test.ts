import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { resetModules } from '../../testing/fakes/modules.js'
import { writeAliasPackage, writeAliasPackageSubpath } from '../../testing/node-alias-package.js'
import FakeWiFi, { getFakeWiFiInstances, resetFakeWiFi } from './fakes/ecma-wifi.js'
import NTP, { resetNTP } from './fakes/ntp.js'

/** Map Moddable bare imports to local Node test doubles. */
function installBareSpecifierPackages(): void {
  const modulesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  for (const name of ['network-power', 'wifi-power-policy']) {
    writeAliasPackage(modulesRoot, name, resolve(modulesRoot, `connectivity/${name}.js`))
  }
  writeAliasPackage(modulesRoot, 'modules', resolve(modulesRoot, 'testing/fakes/modules.js'), {
    hasDefaultExport: true,
  })
  writeAliasPackage(modulesRoot, 'network-state', resolve(modulesRoot, 'connectivity/network-state.js'))
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

const ntpSocket = { io: class FakeUDP {} }
const ntpDNS = { io: class FakeDNS {} }

/** Reset platform doubles and install a complete NTP provider for each test. */
async function setup(configValues: Record<string, unknown> = {}) {
  installBareSpecifierPackages()
  resetModules()
  resetFakeWiFi()
  resetNTP()
  ;(globalThis as typeof globalThis & { device: unknown }).device = {
    network: { ntp: { client: { io: NTP, servers: ['default.invalid'], socket: ntpSocket, dns: ntpDNS } } },
  }
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
  const sntpHost = `${'Ntp-01'.repeat(10)}.example.`
  const { NetworkService, time } = await setup({ sntp: sntpHost })
  const service = new NetworkService({ ssid: 'stackchan-ap', password: 'secret' })
  const originalNow = Date.now
  Date.now = () => 0

  try {
    service.connect()
    getFakeWiFiInstances()[0]?.emitGotIP()

    assert.deepEqual(NTP.instances[0].options, { io: NTP, servers: [sntpHost], socket: ntpSocket, dns: ntpDNS })
    NTP.instances[0].respond()
    assert.equal(time.ticks, NTP.nextTime / 1000)
    assert.equal(NTP.instances[0].closed, true)
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

for (const failure of ['error', 'invalid-time', 'timeout', 'constructor'] as const) {
  test(`NetworkService reports a time-sync failure after got-IP on NTP ${failure}`, async () => {
    const { NetworkService, timer } = await setup({ sntp: '192.0.2.123' })
    if (failure === 'constructor') {
      ;(globalThis as typeof globalThis & { device: unknown }).device = {
        network: {
          ntp: {
            client: {
              io: class {
                constructor() {
                  throw new Error('NTP unavailable')
                }
              },
            },
          },
        },
      }
    }
    const service = new NetworkService({ ssid: 'ap', connectionTimeoutMs: 50 })
    const failures: string[] = []
    let connected = false
    const originalNow = Date.now
    Date.now = () => 0
    try {
      service.connect(
        () => {
          connected = true
        },
        (reason) => failures.push(reason ?? ''),
      )
      getFakeWiFiInstances()[0].emitGotIP()
      if (failure === 'error') NTP.instances[0].respond(new Error('NTP failed'))
      else if (failure === 'invalid-time') NTP.instances[0].respond(null, Number.NaN)
      else if (failure === 'timeout') timer.advance(50)
      assert.deepEqual(failures, ['Failed to get time'])
      assert.equal(connected, false)
      if (failure !== 'constructor') assert.equal(NTP.instances[0].closed, true)
      timer.advance(50)
      assert.equal(failures.length, 1)
    } finally {
      Date.now = originalNow
      service.close()
    }
  })
}

test('NetworkService keeps pre-IP timeouts classified as connection failures', async () => {
  const { NetworkService, timer } = await setup({ sntp: 'pool.ntp.org' })
  const service = new NetworkService({ ssid: 'ap', connectionTimeoutMs: 50 })
  let failureReason = ''
  try {
    service.connect(undefined, (reason) => {
      failureReason = reason ?? ''
    })
    timer.advance(50)
    assert.equal(failureReason, 'connection timeout')
    assert.equal(NTP.instances.length, 0)
  } finally {
    service.close()
  }
})

test('NetworkService scanAndConnect reports scan exhaustion when the target access point is not found', async () => {
  const { NetworkService } = await setup()
  FakeWiFi.scanResults = [{ ssid: 'other-ap' }]
  let failureReason = ''
  const service = new NetworkService({ ssid: 'stackchan-ap', password: 'secret' })

  service.scanAndConnect(undefined, (reason) => {
    failureReason = reason ?? ''
  })

  assert.equal(failureReason, 'Access point "stackchan-ap" not found')
  assert.equal(getFakeWiFiInstances()[0]?.connectOptions, undefined)
  service.close()
})

for (const end of ['close', 'timeout', 'disconnect', 'error'] as const) {
  test(`NetworkService cancels NTP on ${end} and ignores its late reply`, async () => {
    const { NetworkService, time, timer } = await setup({ sntp: 'pool.ntp.org' })
    const service = new NetworkService({ ssid: 'ap', connectionTimeoutMs: 50 })
    const now = Date.now
    Date.now = () => 0
    let connected = 0
    try {
      service.connect(() => connected++)
      getFakeWiFiInstances()[0].emitGotIP()
      const ntp = NTP.instances[0]
      if (end === 'close') service.close()
      else if (end === 'timeout') timer.advance(50)
      else if (end === 'error') ntp.respond(new Error('NTP failed'))
      else getFakeWiFiInstances()[0].emitDisconnected()
      assert.equal(ntp.closed, true)
      const previousTime = time.ticks
      ntp.respond()
      assert.equal(time.ticks, previousTime)
      assert.equal(connected, 0)
    } finally {
      Date.now = now
      service.close()
    }
  })
}
