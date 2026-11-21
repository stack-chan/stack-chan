import test from 'node:test'
import assert from 'node:assert/strict'
import { startWiFiScan } from './wifi-scan.js'
function fixture() {
  let callbacks,
    timeout,
    closed = 0
  const calls = []
  const scan = startWiFiScan({
    createWiFi() {
      calls.push('wifi')
      return {
        scan(options) {
          callbacks = options
          calls.push('scan')
        },
        close() {
          closed++
        },
      }
    },
    silenceLogs() {
      calls.push('privacy')
    },
    byteLength: (s) => new TextEncoder().encode(s).length,
    setTimer(fn) {
      timeout = fn
      return 1
    },
    clearTimer() {},
  })
  return {
    scan,
    calls,
    get closed() {
      return closed
    },
    found(item) {
      callbacks.onFound(item)
    },
    complete() {
      callbacks.onComplete()
    },
    timeout() {
      timeout()
    },
  }
}
test('scan uses SDK fields, strongest dedup and bounded results without connecting or saving', async () => {
  const f = fixture()
  assert.deepEqual(f.calls, ['privacy', 'wifi', 'scan'])
  for (let i = 0; i < 30; i++) f.found({ SSID: 'fixture' + i, RSSI: -90 + i, security: 'wpa2_psk' })
  f.found({ SSID: 'fixture29', RSSI: -20, security: 'none' })
  f.found({ SSID: 'invalid', RSSI: NaN, security: 'none' })
  f.found({ SSID: 'あ'.repeat(11), RSSI: -1, security: 'none' })
  f.complete()
  const result = await f.scan.promise
  assert.equal(result.length, 16)
  assert.deepEqual(result[0], { ssid: 'fixture29', rssi: -20, secure: false })
  assert.equal(f.closed, 1)
  f.found({ SSID: 'late', RSSI: -1, security: 'none' })
  f.scan.close()
  assert.equal(f.closed, 1)
})
test('only completed zero-result scan succeeds with empty list', async () => {
  const f = fixture()
  f.complete()
  assert.deepEqual(await f.scan.promise, [])
  for (const action of ['timeout', 'close']) {
    const g = fixture()
    if (action === 'timeout') g.timeout()
    else g.scan.close()
    await assert.rejects(g.scan.promise, /wifi_scan_failed/)
    g.complete()
    assert.equal(g.closed, 1)
  }
})
test('privacy failure does not construct WiFi', async () => {
  let touched = false
  const scan = startWiFiScan({
    silenceLogs() {
      throw new Error('privacy')
    },
    createWiFi() {
      touched = true
    },
    clearTimer() {},
  })
  await assert.rejects(scan.promise, /wifi_scan_failed/)
  assert.equal(touched, false)
})
