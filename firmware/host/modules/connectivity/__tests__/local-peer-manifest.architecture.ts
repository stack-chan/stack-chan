import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const connectivityManifest = JSON.parse(readFileSync('host/modules/connectivity/manifest.json', 'utf8')) as {
  platforms: Record<string, { include?: string[]; modules?: Record<string, string | string[]> }>
}
const bleOnlyManifest = JSON.parse(
  readFileSync('host/modules/connectivity/manifest_local_peer_ble_only.json', 'utf8'),
) as {
  modules: Record<string, string | string[]>
}

test('the 4 MB M5Stack target uses the BLE-only local-peer registry', () => {
  assert.deepEqual(connectivityManifest.platforms['esp32/m5stack']?.include, ['./manifest_local_peer_ble_only.json'])
  assert.equal(bleOnlyManifest.modules['local-peer-transports'], './esp32/local-peer-transports-ble-only')
  assert.deepEqual(bleOnlyManifest.modules['~'], ['./esp32/local-peer-radio', './sim/local-peer-transports'])
  assert.equal(connectivityManifest.platforms['esp32/m5stack_core2'], undefined)
})

test('ESP32 transport binding removes the simulator fallback before adding hardware transports', () => {
  const modules = connectivityManifest.platforms.esp32?.modules
  assert.deepEqual(modules?.['~'], ['./sim/local-peer-transports'])
  assert.equal(modules?.['local-peer-transports'], './esp32/local-peer-transports')
})
