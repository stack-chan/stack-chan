import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { DOMAIN, PREF_KEYS } from '../../preferences/consts.js'
import { writeAliasPackage } from '../../testing/node-alias-package.js'
import { BLE_PREFERENCE_WRITE_WINDOW_MS } from '../preference-write-guard.js'

type FakePreference = {
  resetPreference(values?: Record<string, unknown>): void
  default: {
    get(domain: string, name: string): unknown
  }
}

type TestPreferenceServer = {
  notifications: { value: ArrayBuffer }[]
  onCharacteristicNotifyEnabled(characteristic: { name: string }): void
  receiveAndSetPreference(domain: string, key: string, value: string): void
  enableWrites(durationMs: number): void
}

function installBareSpecifierPackages(): void {
  const modulesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  writeAliasPackage(modulesRoot, 'consts', resolve(modulesRoot, 'preferences/consts.js'))
  writeAliasPackage(
    modulesRoot,
    'preference-write-guard',
    resolve(modulesRoot, 'connectivity/preference-write-guard.js'),
  )
  writeAliasPackage(modulesRoot, 'preference', resolve(modulesRoot, 'testing/fakes/preference.js'), {
    hasDefaultExport: true,
  })
  writeAliasPackage(modulesRoot, 'timer', resolve(modulesRoot, 'testing/fakes/timer.js'), {
    hasDefaultExport: true,
  })
  writeAliasPackage(modulesRoot, 'uartserver', resolve(modulesRoot, 'connectivity/__tests__/fakes/uartserver.js'))
}

async function setup() {
  installBareSpecifierPackages()
  const arrayBufferConstructor = ArrayBuffer as typeof ArrayBuffer & {
    fromString(value: string): ArrayBuffer
  }
  arrayBufferConstructor.fromString = (value) => new TextEncoder().encode(value).buffer as ArrayBuffer
  ;(String as typeof String & { fromArrayBuffer(value: ArrayBuffer): string }).fromArrayBuffer = (value) =>
    new TextDecoder().decode(value)
  const traces: string[] = []
  ;(globalThis as typeof globalThis & { trace: (...messages: unknown[]) => void }).trace = (...messages) => {
    traces.push(messages.map(String).join(''))
  }

  const [preference, preferenceServer, timer] = await Promise.all([
    import('../../testing/fakes/preference.js') as Promise<FakePreference>,
    import('../preference-server.js'),
    import('../../testing/fakes/timer.js'),
  ])
  preference.resetPreference()
  timer.default.reset()
  return { PreferenceServer: preferenceServer.PreferenceServer, preference, timer: timer.default, traces }
}

function notificationPayload(server: TestPreferenceServer, index = 0): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(server.notifications[index]?.value))
}

test('read-only driver type publishes the platform value and rejects BLE overrides', async () => {
  const { PreferenceServer, preference } = await setup()
  preference.resetPreference({ 'driver.type': 'scservo' })
  const server = new PreferenceServer({
    keys: PREF_KEYS,
    effectiveValues: { 'driver.type': 'm5stackchan' },
    readOnlyKeys: ['driver.type'],
  }) as TestPreferenceServer
  server.enableWrites(BLE_PREFERENCE_WRITE_WINDOW_MS)

  server.onCharacteristicNotifyEnabled({ name: 'tx' })
  assert.deepEqual(notificationPayload(server), {
    prop: 'driver.type',
    value: 'm5stackchan',
    readOnly: true,
  })

  server.receiveAndSetPreference(DOMAIN.driver, 'type', 'dynamixel')
  assert.equal(preference.default.get(DOMAIN.driver, 'type'), 'scservo')
  assert.deepEqual(notificationPayload(server, 1), {
    prop: 'driver.type',
    value: 'm5stackchan',
    readOnly: true,
  })
})

test('unlocked driver type remains writable for other platforms', async () => {
  const { PreferenceServer, preference } = await setup()
  const server = new PreferenceServer({
    keys: PREF_KEYS,
    effectiveValues: { 'driver.type': 'm5stackchan' },
  }) as TestPreferenceServer
  server.enableWrites(BLE_PREFERENCE_WRITE_WINDOW_MS)

  server.onCharacteristicNotifyEnabled({ name: 'tx' })
  server.receiveAndSetPreference(DOMAIN.driver, 'type', 'scservo')

  assert.equal(preference.default.get(DOMAIN.driver, 'type'), 'scservo')
  assert.deepEqual(notificationPayload(server, 1), { prop: 'driver.type', value: 'scservo' })
})

function wire(value: unknown): ArrayBuffer {
  return new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).buffer as ArrayBuffer
}

test('new servers deny direct and wire writes without notifications or callbacks', async () => {
  const { PreferenceServer, preference } = await setup()
  const changes: unknown[] = []
  const server = new PreferenceServer({ keys: PREF_KEYS, onPreferenceChanged: (...args) => changes.push(args) })
  server.onCharacteristicNotifyEnabled({ name: 'tx' })
  server.receiveAndSetPreference('wifi', 'ssid', 'direct')
  server.onRX(wire({ _batch: { 'wifi.ssid': 'wire', 'wifi.password': 'secret' } }))
  assert.equal(preference.default.get('wifi', 'ssid'), undefined)
  assert.equal(preference.default.get('wifi', 'password'), undefined)
  assert.deepEqual(changes, [])
  assert.deepEqual(server.notifications, [])
})

test('fragmented batches preserve numeric strings and empty strings but reject unsupported keys', async () => {
  const { PreferenceServer, preference } = await setup()
  const changes: unknown[] = []
  const server = new PreferenceServer({ keys: PREF_KEYS, onPreferenceChanged: (...args) => changes.push(args) })
  server.enableWrites(BLE_PREFERENCE_WRITE_WINDOW_MS)
  const payload = JSON.stringify({
    _batch: {
      'wifi.ssid': 'network',
      'tts.port': '50021',
      'wifi.password': '',
      'other.token': 'bad',
      'wifi.other': 'bad',
      'wifi.ssid.extra': 'bad',
      'wifi..ssid': 'bad',
    },
  })
  server.onRX(wire(payload.slice(0, 30)))
  assert.equal(preference.default.get('wifi', 'ssid'), undefined)
  server.onRX(wire(payload.slice(30)))
  assert.equal(preference.default.get('wifi', 'ssid'), 'network')
  assert.equal(preference.default.get('tts', 'port'), '50021')
  assert.equal(preference.default.get('wifi', 'password'), '')
  assert.equal(preference.default.get('other', 'token'), undefined)
  assert.equal(preference.default.get('wifi', 'other'), undefined)
  assert.deepEqual(changes, [
    ['wifi.ssid', 'network'],
    ['tts.port', '50021'],
    ['wifi.password', ''],
  ])
})

test('single writes require exact property names and reject malformed property types', async () => {
  const { PreferenceServer, preference } = await setup()
  const server = new PreferenceServer({ keys: PREF_KEYS })
  server.enableWrites(BLE_PREFERENCE_WRITE_WINDOW_MS)
  for (const prop of ['wifi.ssid.extra', 'wifi', 'wifi.', '.ssid', 42, {}, ['wifi.ssid']]) {
    assert.doesNotThrow(() => server.onRX(wire({ prop, value: 'invalid' })))
  }
  assert.equal(preference.default.get('wifi', 'ssid'), undefined)
  server.onRX(wire({ prop: 'wifi.ssid', value: 'single' }))
  assert.equal(preference.default.get('wifi', 'ssid'), 'single')
})

test('five-minute expiry rejects messages whose first fragment arrived before the deadline', async () => {
  const { PreferenceServer, preference, timer } = await setup()
  const server = new PreferenceServer({ keys: PREF_KEYS })
  server.enableWrites(BLE_PREFERENCE_WRITE_WINDOW_MS)
  timer.advance(BLE_PREFERENCE_WRITE_WINDOW_MS - 1)
  server.onRX(wire({ prop: 'wifi.ssid', value: 'before' }))
  server.onRX(wire('{"prop":"wifi.password","value":'))
  timer.advance(1)
  server.onRX(wire('"after"}'))
  server.onRX(wire({ _batch: { 'wifi.ssid': 'after', 'wifi.password': 'after' } }))
  server.receiveAndSetPreference('wifi', 'ssid', 'direct-after')
  assert.equal(preference.default.get('wifi', 'ssid'), 'before')
  assert.equal(preference.default.get('wifi', 'password'), undefined)
})

test('disable clears timers and partial messages, allowing a fresh explicit window', async () => {
  const { PreferenceServer, preference, timer, traces } = await setup()
  const server = new PreferenceServer({ keys: PREF_KEYS })
  server.enableWrites(1000)
  server.onRX(wire('{"prop":"wifi.ssid","value":'))
  server.disableWrites()
  traces.length = 0
  timer.advance(BLE_PREFERENCE_WRITE_WINDOW_MS)
  assert.deepEqual(traces, [])
  server.receiveAndSetPreference('wifi', 'ssid', 'disabled')
  assert.equal(preference.default.get('wifi', 'ssid'), undefined)
  server.enableWrites(BLE_PREFERENCE_WRITE_WINDOW_MS)
  server.onRX(wire({ prop: 'wifi.ssid', value: 'fresh' }))
  assert.equal(preference.default.get('wifi', 'ssid'), 'fresh')
})

test('renewing a window cancels its earlier expiry', async () => {
  const { PreferenceServer, preference, timer } = await setup()
  const server = new PreferenceServer({ keys: PREF_KEYS })
  server.enableWrites(1000)
  timer.advance(500)
  server.enableWrites(1000)
  timer.advance(500)
  server.receiveAndSetPreference('wifi', 'ssid', 'renewed')
  timer.advance(500)
  server.receiveAndSetPreference('wifi', 'ssid', 'expired')
  assert.equal(preference.default.get('wifi', 'ssid'), 'renewed')
})

test('invalid durations fail closed rather than enabling writes indefinitely', async () => {
  const { PreferenceServer, preference } = await setup()
  const server = new PreferenceServer({ keys: PREF_KEYS })
  for (const duration of [0, -1, NaN, Infinity, undefined]) {
    server.enableWrites(BLE_PREFERENCE_WRITE_WINDOW_MS)
    server.enableWrites(duration as number)
    server.receiveAndSetPreference('wifi', 'ssid', 'invalid-duration')
    assert.equal(preference.default.get('wifi', 'ssid'), undefined)
  }
})

test('timer allocation failure leaves writes disabled', async () => {
  const { PreferenceServer, preference, timer } = await setup()
  const server = new PreferenceServer({ keys: PREF_KEYS })
  const originalSet = timer.set
  timer.set = () => {
    throw new Error('add failed')
  }
  try {
    assert.throws(() => server.enableWrites(BLE_PREFERENCE_WRITE_WINDOW_MS), /add failed/)
    server.receiveAndSetPreference('wifi', 'ssid', 'unbounded')
    assert.equal(preference.default.get('wifi', 'ssid'), undefined)
  } finally {
    timer.set = originalSet
  }
})

test('disconnect clears fragments and notification state without extending the window', async () => {
  const { PreferenceServer, preference, timer } = await setup()
  const server = new PreferenceServer({ keys: PREF_KEYS })
  server.enableWrites(1000)
  server.onCharacteristicNotifyEnabled({ name: 'tx' })
  server.onRX(wire('{"prop":"wifi.ssid","value":'))
  timer.advance(500)
  server.onDisconnected()
  server.onConnected()
  server.onRX(wire({ prop: 'wifi.ssid', value: 'reconnected' }))
  assert.equal(preference.default.get('wifi', 'ssid'), 'reconnected')
  assert.deepEqual(server.notifications, [])
  timer.advance(500)
  server.receiveAndSetPreference('wifi', 'ssid', 'expired')
  assert.equal(preference.default.get('wifi', 'ssid'), 'reconnected')
})

test('close cancels timers and prevents reopening or advertising', async () => {
  const { PreferenceServer, preference, timer, traces } = await setup()
  const server = new PreferenceServer({ keys: PREF_KEYS })
  server.enableWrites(1000)
  server.onRX(wire('{"prop":"wifi.ssid","value":'))
  server.close()
  server.close()
  assert.equal(server.closed, true)
  traces.length = 0
  timer.advance(BLE_PREFERENCE_WRITE_WINDOW_MS)
  assert.deepEqual(traces, [])
  server.enableWrites(BLE_PREFERENCE_WRITE_WINDOW_MS)
  server.onDisconnected()
  server.onRX(wire({ prop: 'wifi.ssid', value: 'closed' }))
  server.receiveAndSetPreference('wifi', 'ssid', 'closed')
  assert.equal(preference.default.get('wifi', 'ssid'), undefined)
  assert.deepEqual(server.advertisingStarts, [])
})

test('effective values suppress unchanged writes and supported changes still notify', async () => {
  const { PreferenceServer, preference } = await setup()
  const changes: unknown[] = []
  const server = new PreferenceServer({
    keys: PREF_KEYS,
    effectiveValues: { 'wifi.ssid': 'effective' },
    onPreferenceChanged: (...args) => changes.push(args),
  })
  server.enableWrites(BLE_PREFERENCE_WRITE_WINDOW_MS)
  server.onCharacteristicNotifyEnabled({ name: 'tx' })
  assert.deepEqual(notificationPayload(server), { prop: 'wifi.ssid', value: 'effective' })
  server.receiveAndSetPreference('wifi', 'ssid', 'effective')
  assert.equal(preference.default.get('wifi', 'ssid'), undefined)
  assert.deepEqual(changes, [])
  server.receiveAndSetPreference('wifi', 'ssid', 'changed')
  assert.deepEqual(changes, [['wifi.ssid', 'changed']])
  assert.deepEqual(notificationPayload(server, 1), { prop: 'wifi.ssid', value: 'changed' })
})
