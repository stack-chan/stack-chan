import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const publicSources = [
  'host/app/capabilities.ts',
  'host/modules/connectivity/local-peer-types.ts',
  'mods/examples/local_peer_hello/mod.js',
  'docs/local-peer-communication_ja.md',
]

test('public local peer APIs do not expose the ESP32 transport implementation name', () => {
  for (const path of publicSources) {
    const source = readFileSync(path, 'utf8')
    assert.doesNotMatch(source, /esp[-_ ]?now/i, `${path} should use only the local peer abstraction`)
  }
})

test('local peer capability exposes the planned message API and keeps platform selection in the manifest', () => {
  const types = readFileSync('host/modules/connectivity/local-peer-types.ts', 'utf8')
  const manifest = readFileSync('host/modules/connectivity/manifest.json', 'utf8')
  for (const method of ['discover', 'send', 'broadcast', 'subscribe', 'close']) {
    assert.match(types, new RegExp(`\\b${method}\\(`))
  }
  assert.match(manifest, /"local-peer-radio": "\.\/esp32\/local-peer-radio"/)
  assert.match(manifest, /"local-peer-capability": "\.\/sim\/local-peer-capability"/)
})

test('offline setup clears both stored credentials through one connectivity operation', () => {
  const setup = readFileSync('host/app/setup-mode.ts', 'utf8')
  const storedWiFi = readFileSync('host/modules/connectivity/stored-wifi.ts', 'utf8')
  assert.match(setup, /clearStoredWiFiCredentials\(\)/)
  assert.match(storedWiFi, /Preference\.set\(DOMAIN\.wifi, 'ssid', ''\)/)
  assert.match(storedWiFi, /Preference\.set\(DOMAIN\.wifi, 'password', ''\)/)
})
