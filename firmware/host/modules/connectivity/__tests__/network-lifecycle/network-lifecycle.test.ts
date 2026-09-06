import { startHostBootServices } from 'boot-services'
import WiFi from 'ecma-wifi'
import {
  networkAvailability,
  openNetworkConnection,
  startNetworkConnection,
  stopNetworkConnection,
} from 'network-manager'
import { NetworkService } from 'network-service'
import { NetworkConnectionState as State } from 'network-state'
import { assert, equal } from 'testing/assert'
import Timer from 'timer'
import { NetworkService as WasmNetworkService } from 'wasm-network-service'
import { scanWiFiNetworks } from 'wifi-scan'

const credentials = { ssid: 'robot-ap', password: 'password' }
function latest() {
  return WiFi.instances[WiFi.instances.length - 1]
}
function expectCode(callback: () => void, code: string, message: string) {
  let failure: unknown
  try {
    callback()
  } catch (error) {
    failure = error
  }
  equal((failure as { code?: string })?.code, code, message)
}
async function settle() {
  for (let i = 0; i < 16; i++) await Promise.resolve()
}
const wait = (ms: number) => new Promise<void>((resolve) => Timer.set(() => resolve(), ms))

async function leases() {
  equal(networkAvailability, 'simulated', 'simulated metadata must be explicit')
  for (let i = 0; i < 100; i++) {
    let firstCalls = 0
    let secondCalls = 0
    const first = openNetworkConnection({
      ...credentials,
      onConnected() {
        firstCalls++
      },
    })
    const wifi = latest()
    const second = openNetworkConnection({
      ...credentials,
      onConnected() {
        secondCalls++
      },
    })
    equal(wifi.connects, 1, 'matching leases share one adapter')
    expectCode(() => openNetworkConnection({ ssid: 'other-ap' }), 'BUSY', 'other credentials cannot steal Wi-Fi')
    first.close()
    first.close()
    equal(wifi.closes, 0, 'closing one consumer keeps the other connected')
    wifi.changed(500)
    equal(firstCalls, 0, 'closed consumer receives no completion')
    equal(secondCalls, 1, 'remaining consumer receives completion')
    second.close()
    equal(wifi.closes, 1, 'last lease closes physical adapter exactly once')
  }
  const host = openNetworkConnection(credentials)
  expectCode(
    () => openNetworkConnection({ ...credentials, connectionTimeoutMs: NaN }),
    'INVALID_ARGUMENT',
    'joining a connection validates its arguments too',
  )
  const wifi = latest()
  startNetworkConnection(credentials)
  stopNetworkConnection()
  equal(wifi.closes, 0, 'V1 stop cannot release an owned host lease')
  host.close()
  const consumers = Array.from({ length: 16 }, () => openNetworkConnection(credentials))
  expectCode(() => openNetworkConnection(credentials), 'BUSY', 'consumer capacity is bounded')
  for (const consumer of consumers) consumer.close()
  expectCode(
    () => openNetworkConnection({ ssid: 'x'.repeat(33) }),
    'INVALID_ARGUMENT',
    'invalid credentials fail before IO',
  )
}

async function lateEventsAndDeadlines() {
  let scanUpdates = 0
  const settingsScan = scanWiFiNetworks({
    onFound() {
      scanUpdates++
    },
    onComplete() {
      scanUpdates++
    },
  })
  const settingsWifi = latest()
  settingsScan.close()
  settingsWifi.scanOptions[0].onFound({ ssid: 'late' })
  settingsWifi.scanOptions[0].onComplete()
  equal(scanUpdates, 0, 'cancelled settings scan cannot update a later screen')
  equal(settingsWifi.closes, 1, 'settings scan closes once')
  let completions = 0
  const lease = openNetworkConnection({
    ...credentials,
    scanBeforeConnect: true,
    onConnected() {
      completions++
    },
  })
  const wifi = latest()
  const scan = wifi.scanOptions[0]
  lease.close()
  scan.onFound({ ssid: credentials.ssid })
  scan.onComplete()
  wifi.changed(500)
  equal(wifi.connects, 0, 'late scan cannot start a closed adapter')
  equal(completions, 0, 'late events cannot complete a closed consumer')

  let reason: string | undefined
  const timed = openNetworkConnection({
    ...credentials,
    scanBeforeConnect: true,
    connectionTimeoutMs: 5,
    onError(value) {
      reason = value
    },
  })
  const timedWifi = latest()
  await wait(15)
  equal(reason, 'connection timeout', 'silent scan is covered by attempt deadline')
  equal(timed.state, State.FAILED, 'timeout is reflected in state')
  timedWifi.scanOptions[0].onFound({ ssid: credentials.ssid })
  equal(timedWifi.connects, 0, 'late scan cannot revive a timed out attempt')
  timed.close()

  reason = undefined
  const exhausted = openNetworkConnection({
    ...credentials,
    scanBeforeConnect: true,
    onError(value) {
      reason = value
    },
  })
  const exhaustedWifi = latest()
  for (let i = 0; i < 3; i++) {
    exhaustedWifi.scanOptions[i].onComplete()
    await wait(2)
  }
  assert(reason?.includes('not found'), 'exhausted scans return an actionable failure')
  exhausted.close()

  const reconnect = openNetworkConnection({ ...credentials, reconnectDelayMs: 5 })
  const reconnectWifi = latest()
  reconnectWifi.changed(500)
  reconnectWifi.changed(200)
  equal(reconnect.state, State.RECONNECTING, 'lost connection schedules reconnect')
  reconnect.close()
  await wait(15)
  equal(reconnectWifi.connects, 1, 'close cancels reconnect timer')

  const badObserver = openNetworkConnection({
    ...credentials,
    onStateChanged() {
      throw new Error('observer')
    },
    onConnected() {
      throw new Error('observer')
    },
  })
  latest().changed(500)
  equal(badObserver.state, State.CONNECTED, 'observer failures cannot own the adapter')
  badObserver.close()
}

async function bootReplacement() {
  const old = startHostBootServices({ credentials })
  await settle()
  const oldWifi = latest()
  const oldScan = oldWifi.scanOptions[0]
  const next = startHostBootServices({ credentials })
  await settle()
  equal(old.closed, true, 'new boot closes previous owner')
  equal(oldWifi.closes, 1, 'previous adapter is closed before replacement')
  const oldResult = await old.connectivity.network.ready
  equal(oldResult.status === 'failed' && oldResult.code, 'CLOSED', 'old readiness settles as closed')
  const nextWifi = latest()
  assert(nextWifi !== oldWifi, 'replacement uses a new adapter')
  oldScan.onFound({ ssid: credentials.ssid })
  equal(oldWifi.connects, 0, 'old scan cannot cross boot generations')
  nextWifi.scanOptions[0].onFound({ ssid: credentials.ssid })
  nextWifi.changed(500)
  equal((await next.connectivity.network.ready).status, 'connected', 'replacement boot can connect')
  await old.close()
  equal(nextWifi.closes, 0, 'old owner cannot close replacement')
  await next.close()
}

async function ntpAndCloseFailures() {
  class Ntp {
    static current: Ntp
    callback: (error: unknown, time?: number) => void
    closes = 0
    failClose = false
    constructor(_options: unknown) {
      Ntp.current = this
    }
    getTime(callback: (error: unknown, time?: number) => void) {
      this.callback = callback
    }
    close() {
      this.closes++
      if (this.failClose) throw new Error('NTP close failed')
    }
  }
  const environment = globalThis as unknown as { device?: unknown }
  const previousDevice = environment.device
  const previousDate = Date
  environment.device = { network: { ntp: { client: { io: Ntp } } } }
  globalThis.Date = class extends previousDate {
    static now() {
      return 0
    }
  } as unknown as DateConstructor
  try {
    let complete = 0
    const service = new NetworkService({ ...credentials, onStateChanged() {} })
    service.connect(() => {
      complete++
    })
    const wifi = latest()
    wifi.changed(500)
    equal(service.state, State.SYNCING_TIME, 'IP is not complete before time synchronization')
    const ntp = Ntp.current
    service.close()
    equal(ntp.closes, 1, 'close releases NTP')
    ntp.callback(new Error('late callback'))
    equal(complete, 0, 'closed time synchronization cannot complete boot')
    expectCode(() => service.connect(), 'CLOSED', 'closed service cannot reopen')

    const fault = new NetworkService(credentials)
    fault.connect()
    const faultWifi = latest()
    faultWifi.changed(500)
    Ntp.current.failClose = true
    faultWifi.failDisconnect = true
    expectCode(() => fault.close(), 'IO', 'cleanup failure is observable')
    equal(faultWifi.closes, 1, 'NTP and disconnect failures still attempt adapter close')
    expectCode(() => fault.close(), 'IO', 'repeat close preserves the failure')
    equal(faultWifi.closes, 1, 'repeat close does not repeat physical cleanup')
  } finally {
    globalThis.Date = previousDate
    environment.device = previousDevice
  }

  const wasm = new WasmNetworkService(credentials)
  equal(WasmNetworkService.availability, 'unavailable', 'WASM reports lack of Wi-Fi')
  expectCode(() => wasm.connect(), 'UNSUPPORTED', 'WASM cannot fake connection success')
  wasm.close()
  expectCode(() => wasm.connect(), 'CLOSED', 'closed WASM adapter is closed consistently')

  // Faulting the module-wide manager is intentionally the final case.
  const lease = openNetworkConnection(credentials)
  latest().failClose = true
  expectCode(() => lease.close(), 'IO', 'last-owner cleanup failure reaches caller')
  expectCode(() => openNetworkConnection(credentials), 'IO', 'failed physical cleanup prevents reuse')
}

async function run() {
  await leases()
  await lateEventsAndDeadlines()
  await bootReplacement()
  await ntpAndCloseFailures()
  trace('ok\n')
}
run().catch((error) => {
  trace(`unhandled exception: network lifecycle failed: ${String(error)}\n`)
  throw error
})
