import assert from 'node:assert/strict'
import test from 'node:test'
import { createAccountNetwork } from './account-network.js'

function fixture(overrides = {}) {
  const calls = []
  let wifi, ntp, timeout
  const network = createAccountNetwork({
    silenceLogs() {
      calls.push('privacy')
    },
    createWiFi(options) {
      wifi = {
        ...options,
        connection: 0,
        disconnect() {
          calls.push('disconnect')
        },
        close() {
          calls.push('wifiClose')
        },
      }
      calls.push('wifi')
      return wifi
    },
    connectNative(owner, generation) {
      assert.equal(owner, 'opaque')
      assert.equal(generation, 7)
      calls.push('native')
    },
    createNTP() {
      ntp = {
        getTime(fn) {
          ntp.result = fn
        },
        close() {
          calls.push('ntpClose')
        },
      }
      calls.push('ntp')
      return ntp
    },
    setTime(value) {
      calls.push(['time', value])
    },
    setTimer(fn) {
      timeout = fn
      return 1
    },
    clearTimer() {
      calls.push('clear')
    },
    ...overrides,
  })
  return {
    network,
    calls,
    get wifi() {
      return wifi
    },
    get ntp() {
      return ntp
    },
    timeout() {
      timeout()
    },
  }
}
test('explicit prepare gates native WiFi then IP then real NTP', async () => {
  const f = fixture()
  assert.deepEqual(f.calls, [])
  let ready = false
  const p = f.network.prepare('opaque', 7).then(() => (ready = true))
  assert.deepEqual(f.calls, ['privacy', 'wifi', 'native'])
  assert.equal(ready, false)
  f.wifi.connection = 500
  f.wifi.onChanged()
  assert.equal(ready, false)
  f.ntp.result(null, 1800000000000)
  await p
  assert.equal(ready, true)
  assert.ok(f.calls.some((x) => Array.isArray(x) && x[1] === 1800000000))
  f.network.close()
  assert.deepEqual(f.calls.slice(-2), ['disconnect', 'wifiClose'])
})
test('close during NTP rejects pending and discards late callback', async () => {
  const f = fixture(),
    p = f.network.prepare('opaque', 7)
  f.wifi.connection = 500
  f.wifi.onChanged()
  const cb = f.ntp.result
  f.network.close()
  await assert.rejects(p, /network_closed/)
  cb(null, 1800000000000)
  assert.equal(f.calls.some(Array.isArray), false)
})
test('timeout fails closed and old WiFi callback cannot recreate NTP', async () => {
  const f = fixture(),
    p = f.network.prepare('opaque', 7),
    old = f.wifi
  f.timeout()
  await assert.rejects(p, /network_unavailable/)
  old.connection = 500
  old.onChanged()
  assert.equal(f.calls.includes('ntp'), false)
})

test('NTP constructor failure exposes only a fixed diagnostic stage', async () => {
  const diagnostics = []
  const f = fixture({
    createNTP() {
      throw new Error('private provider detail')
    },
    onDiagnostic(value) {
      diagnostics.push(value)
    },
  })
  const p = f.network.prepare('opaque', 7)
  f.wifi.connection = 500
  f.wifi.onChanged()
  await assert.rejects(p, /network_unavailable/)
  assert.deepEqual(diagnostics, ['ntp_start', 'ntp_create_failed', 'ntp_failed'])
})
test('NTP success records stages without exposing network or server values', async () => {
  const diagnostics = []
  const f = fixture({
    onDiagnostic(value) {
      diagnostics.push(value)
    },
  })
  const p = f.network.prepare('opaque', 7)
  f.wifi.connection = 500
  f.wifi.onChanged()
  f.ntp.result(null, 1800000000000)
  await p
  assert.deepEqual(diagnostics, ['ntp_start', 'ntp_create_ready', 'ntp_ready'])
  f.network.close()
})

test('native Wi-Fi diagnostics are read before the watch is closed', async () => {
  const events = []
  const f = fixture({
    wifiFailure() {
      events.push('reason')
      return 'auth'
    },
    closeNative() {
      events.push('unwatch')
    },
    onDiagnostic(value) {
      events.push(value)
    },
  })
  const pending = f.network.prepare('opaque', 7)
  f.timeout()
  await assert.rejects(pending, /network_unavailable/)
  assert.deepEqual(events, ['reason', 'wifi_reason_auth', 'wifi_failed', 'unwatch'])
})
test('unexpected Wi-Fi diagnostics never escape and cannot block cleanup', async () => {
  const seen = []
  const f = fixture({
    wifiFailure() {
      throw new Error('PRIVATE_NETWORK_DETAIL')
    },
    closeNative() {
      seen.push('closed')
    },
    onDiagnostic(value) {
      seen.push(value)
    },
  })
  const pending = f.network.prepare('opaque', 7)
  f.timeout()
  await assert.rejects(pending, /network_unavailable/)
  assert.deepEqual(seen, ['wifi_failed', 'closed'])
})
