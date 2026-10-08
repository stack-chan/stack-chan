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
  writeAliasPackage(modulesRoot, 'time', resolve(modulesRoot, 'testing/fakes/time.js'), { hasDefaultExport: true })
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

  const [preference, preferenceServer, timer, time] = await Promise.all([
    import('../../testing/fakes/preference.js') as Promise<FakePreference>,
    import('../preference-server.js'),
    import('../../testing/fakes/timer.js'),
    import('../../testing/fakes/time.js'),
  ])
  preference.resetPreference()
  timer.default.reset()
  time.default.reset()
  function advance(ms: number) {
    time.default.setTicks(time.default.ticks + ms)
    timer.default.advance(ms)
  }
  return { PreferenceServer: preferenceServer.PreferenceServer, preference, timer: timer.default, advance, traces }
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
  const { PreferenceServer, preference, advance } = await setup()
  const server = new PreferenceServer({ keys: PREF_KEYS })
  server.enableWrites(BLE_PREFERENCE_WRITE_WINDOW_MS)
  advance(BLE_PREFERENCE_WRITE_WINDOW_MS - 1)
  server.onRX(wire({ prop: 'wifi.ssid', value: 'before' }))
  server.onRX(wire('{"prop":"wifi.password","value":'))
  advance(1)
  server.onRX(wire('"after"}'))
  server.onRX(wire({ _batch: { 'wifi.ssid': 'after', 'wifi.password': 'after' } }))
  server.receiveAndSetPreference('wifi', 'ssid', 'direct-after')
  assert.equal(preference.default.get('wifi', 'ssid'), 'before')
  assert.equal(preference.default.get('wifi', 'password'), undefined)
})

test('disable clears timers and partial messages, allowing a fresh explicit window', async () => {
  const { PreferenceServer, preference, advance, traces } = await setup()
  const server = new PreferenceServer({ keys: PREF_KEYS })
  server.enableWrites(1000)
  server.onRX(wire('{"prop":"wifi.ssid","value":'))
  server.disableWrites()
  traces.length = 0
  advance(BLE_PREFERENCE_WRITE_WINDOW_MS)
  assert.deepEqual(traces, [])
  server.receiveAndSetPreference('wifi', 'ssid', 'disabled')
  assert.equal(preference.default.get('wifi', 'ssid'), undefined)
  server.enableWrites(BLE_PREFERENCE_WRITE_WINDOW_MS)
  server.onRX(wire({ prop: 'wifi.ssid', value: 'fresh' }))
  assert.equal(preference.default.get('wifi', 'ssid'), 'fresh')
})

test('renewing a window cancels its earlier expiry', async () => {
  const { PreferenceServer, preference, advance } = await setup()
  const server = new PreferenceServer({ keys: PREF_KEYS })
  server.enableWrites(1000)
  advance(500)
  server.enableWrites(1000)
  advance(500)
  server.receiveAndSetPreference('wifi', 'ssid', 'renewed')
  advance(500)
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
  const { PreferenceServer, preference, advance } = await setup()
  const server = new PreferenceServer({ keys: PREF_KEYS })
  server.enableWrites(1000)
  server.onCharacteristicNotifyEnabled({ name: 'tx' })
  server.onRX(wire('{"prop":"wifi.ssid","value":'))
  advance(500)
  server.onDisconnected()
  server.onConnected()
  server.onRX(wire({ prop: 'wifi.ssid', value: 'reconnected' }))
  assert.equal(preference.default.get('wifi', 'ssid'), 'reconnected')
  assert.deepEqual(server.notifications, [])
  advance(500)
  server.receiveAndSetPreference('wifi', 'ssid', 'expired')
  assert.equal(preference.default.get('wifi', 'ssid'), 'reconnected')
})

test('close cancels timers and prevents reopening or advertising', async () => {
  const { PreferenceServer, preference, advance, traces } = await setup()
  const server = new PreferenceServer({ keys: PREF_KEYS })
  server.enableWrites(1000)
  server.onRX(wire('{"prop":"wifi.ssid","value":'))
  server.close()
  server.close()
  assert.equal(server.closed, true)
  traces.length = 0
  advance(BLE_PREFERENCE_WRITE_WINDOW_MS)
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

// Time advances independently while expiry delivery waits: callbacks cannot
// substitute for elapsed-time authorization at the receive/storage boundary.

for (const mode of [
  'single-at-deadline',
  'batch-after-deadline',
  'crossing-fragments',
  'direct-after-reconnect',
] as const) {
  test(`delayed expiry callback rejects ${mode}`, async () => {
    const { PreferenceServer, preference, timer } = await setup()
    const time = (await import('../../testing/fakes/time.js')).default
    time.reset()
    const changes: unknown[] = []
    preference.resetPreference({ 'tts.volume': '0.20' })
    const server = new PreferenceServer({ keys: PREF_KEYS, onPreferenceChanged: (...args) => changes.push(args) })
    const originalSet = timer.set
    const pending: (() => void)[] = []
    timer.set = (callback, interval = 0) =>
      originalSet((handle) => {
        if (interval === BLE_PREFERENCE_WRITE_WINDOW_MS) pending.push(() => callback(handle))
        else callback(handle)
      }, interval)
    function advance(milliseconds: number) {
      time.setTicks(time.ticks + milliseconds)
      timer.advance(milliseconds)
    }
    try {
      server.enableWrites(BLE_PREFERENCE_WRITE_WINDOW_MS)
      if (mode === 'crossing-fragments') {
        advance(BLE_PREFERENCE_WRITE_WINDOW_MS - 1)
        server.onCharacteristicWritten({ name: 'rx' }, wire('{"prop":"tts.volume","value":'))
        advance(2)
        server.onCharacteristicWritten({ name: 'rx' }, wire('"0.21"}'))
      } else if (mode === 'single-at-deadline') {
        advance(BLE_PREFERENCE_WRITE_WINDOW_MS)
        server.onCharacteristicWritten({ name: 'rx' }, wire({ prop: 'tts.volume', value: '0.21' }))
      } else if (mode === 'batch-after-deadline') {
        advance(BLE_PREFERENCE_WRITE_WINDOW_MS + 1)
        server.onCharacteristicWritten(
          { name: 'rx' },
          wire({ _batch: { 'tts.volume': '0.21', 'other.key': 'ignored' } }),
        )
      } else {
        advance(BLE_PREFERENCE_WRITE_WINDOW_MS + 1)
        server.onDisconnected()
        server.onConnected()
        server.receiveAndSetPreference('tts', 'volume', '0.21')
      }
      const lateValue = preference.default.get('tts', 'volume')
      console.log(
        JSON.stringify({
          mode,
          clockMs: time.ticks,
          pendingExpiryCallbacks: pending.length,
          observedStoredVolume: lateValue,
          callbacks: changes.length,
          fragmentGapMs: mode === 'crossing-fragments' ? 2 : null,
          notificationSubscriptions: 0,
          hardware: false,
        }),
      )
      assert.ok(time.ticks >= BLE_PREFERENCE_WRITE_WINDOW_MS)
      assert.equal(pending.length, 1, 'expiry became due but its callback has not been delivered')
      assert.equal(lateValue, '0.20', 'five-minute elapsed-time acceptance invariant')
      assert.equal(changes.length, 0)
      assert.equal(preference.default.get('other', 'key'), undefined)

      // The eventual callback stops subsequent writes; it does not roll back a late commit.
      pending.shift()?.()
      server.onRX(wire({ prop: 'tts.volume', value: '0.22' }))
      server.receiveAndSetPreference('tts', 'volume', '0.22')
      assert.equal(preference.default.get('tts', 'volume'), lateValue)
    } finally {
      timer.set = originalSet
      server.close()
      timer.reset()
      time.reset()
    }
  })
}

async function clockedSetup() {
  const context = await setup()
  const time = (await import('../../testing/fakes/time.js')).default
  time.reset()
  context.preference.resetPreference({ 'tts.volume': '0.20' })
  return { ...context, time }
}

for (const start of [0x7ffffff0, -16]) {
  test(`elapsed deadline survives signed/unsigned ESP32 tick rollover from ${start}`, async () => {
    const { PreferenceServer, preference, time } = await clockedSetup()
    time.setTicks(start)
    const server = new PreferenceServer({ keys: PREF_KEYS })
    server.enableWrites(BLE_PREFERENCE_WRITE_WINDOW_MS)
    time.setTicks((start + BLE_PREFERENCE_WRITE_WINDOW_MS - 1) | 0)
    assert.equal(time.delta(start), BLE_PREFERENCE_WRITE_WINDOW_MS - 1)
    server.onRX(wire({ prop: 'tts.volume', value: '0.21' }))
    time.setTicks((start + BLE_PREFERENCE_WRITE_WINDOW_MS) | 0)
    assert.equal(time.delta(start), BLE_PREFERENCE_WRITE_WINDOW_MS)
    server.onRX(wire({ prop: 'tts.volume', value: '0.22' }))
    assert.equal(preference.default.get('tts', 'volume'), '0.21')
    server.close()
  })
}

test('batch entries are checked again when an earlier change callback crosses expiry', async () => {
  const { PreferenceServer, preference, time } = await clockedSetup()
  const changes: unknown[] = []
  const server = new PreferenceServer({
    keys: PREF_KEYS,
    onPreferenceChanged: (...args) => {
      changes.push(args)
      time.setTicks(BLE_PREFERENCE_WRITE_WINDOW_MS)
    },
  })
  server.enableWrites(BLE_PREFERENCE_WRITE_WINDOW_MS)
  time.setTicks(BLE_PREFERENCE_WRITE_WINDOW_MS - 1)
  server.onRX(wire({ _batch: { 'tts.volume': '0.21', 'tts.port': '50021' } }))
  assert.equal(preference.default.get('tts', 'volume'), '0.21')
  assert.equal(preference.default.get('tts', 'port'), undefined)
  assert.deepEqual(changes, [['tts.volume', '0.21']])
  server.close()
})

test('a payload parsed across expiry cannot authorize a late save', async () => {
  const { PreferenceServer, preference, time } = await clockedSetup()
  const changes: unknown[] = []
  const server = new PreferenceServer({ keys: PREF_KEYS, onPreferenceChanged: (...args) => changes.push(args) })
  server.enableWrites(BLE_PREFERENCE_WRITE_WINDOW_MS)
  time.setTicks(BLE_PREFERENCE_WRITE_WINDOW_MS - 1)
  const payload = wire({ prop: 'tts.volume', value: '0.21' })
  const originalParse = JSON.parse
  JSON.parse = (...args) => {
    time.setTicks(BLE_PREFERENCE_WRITE_WINDOW_MS)
    return originalParse(...args)
  }
  try {
    server.onRX(payload)
  } finally {
    JSON.parse = originalParse
  }
  assert.equal(preference.default.get('tts', 'volume'), '0.20')
  assert.deepEqual(changes, [])
  server.close()
})

test('the final clock check rejects a write whose storage read crosses expiry', async () => {
  const { PreferenceServer, preference, time } = await clockedSetup()
  const changes: unknown[] = []
  const server = new PreferenceServer({ keys: PREF_KEYS, onPreferenceChanged: (...args) => changes.push(args) })
  server.enableWrites(BLE_PREFERENCE_WRITE_WINDOW_MS)
  time.setTicks(BLE_PREFERENCE_WRITE_WINDOW_MS - 1)
  const originalGet = preference.default.get
  preference.default.get = (domain, key) => {
    time.setTicks(BLE_PREFERENCE_WRITE_WINDOW_MS)
    return originalGet(domain, key)
  }
  try {
    server.receiveAndSetPreference('tts', 'volume', '0.21')
  } finally {
    preference.default.get = originalGet
  }
  assert.equal(preference.default.get('tts', 'volume'), '0.20')
  assert.deepEqual(changes, [])
  server.close()
})

test('elapsed expiry clears fragments and old timers before a fresh explicit window', async () => {
  const { PreferenceServer, preference, time, timer, traces } = await clockedSetup()
  const server = new PreferenceServer({ keys: PREF_KEYS })
  server.enableWrites(BLE_PREFERENCE_WRITE_WINDOW_MS)
  server.onRX(wire('{"prop":"tts.volume","value":'))
  time.setTicks(BLE_PREFERENCE_WRITE_WINDOW_MS)
  server.onRX(wire('"0.22"}'))
  assert.equal(preference.default.get('tts', 'volume'), '0.20')
  traces.length = 0
  timer.advance(BLE_PREFERENCE_WRITE_WINDOW_MS)
  assert.deepEqual(traces, [], 'expiry admission check should also cancel both pending timers')
  server.enableWrites(BLE_PREFERENCE_WRITE_WINDOW_MS)
  server.onRX(wire({ prop: 'tts.volume', value: '0.21' }))
  assert.equal(preference.default.get('tts', 'volume'), '0.21')
  server.close()
  server.enableWrites(BLE_PREFERENCE_WRITE_WINDOW_MS)
  server.receiveAndSetPreference('tts', 'volume', '0.22')
  assert.equal(preference.default.get('tts', 'volume'), '0.21')
})

for (const failure of ['throw', 'NaN', 'negative'] as const) {
  test(`elapsed clock ${failure} fails closed until explicit reopen`, async () => {
    const { PreferenceServer, preference, time } = await clockedSetup()
    const server = new PreferenceServer({ keys: PREF_KEYS })
    server.enableWrites(BLE_PREFERENCE_WRITE_WINDOW_MS)
    const originalDelta = time.delta
    time.delta = () => {
      if (failure === 'throw') throw new Error('clock unavailable')
      return failure === 'NaN' ? NaN : -1
    }
    try {
      assert.doesNotThrow(() => server.onRX(wire({ prop: 'tts.volume', value: '0.21' })))
    } finally {
      time.delta = originalDelta
    }
    server.receiveAndSetPreference('tts', 'volume', '0.21')
    assert.equal(preference.default.get('tts', 'volume'), '0.20')
    server.enableWrites(BLE_PREFERENCE_WRITE_WINDOW_MS)
    server.receiveAndSetPreference('tts', 'volume', '0.21')
    assert.equal(preference.default.get('tts', 'volume'), '0.21')
    server.close()
  })
}
