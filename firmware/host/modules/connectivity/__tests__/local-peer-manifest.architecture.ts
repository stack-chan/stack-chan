import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const connectivityManifest = JSON.parse(readFileSync('host/modules/connectivity/manifest.json', 'utf8')) as {
  platforms: Record<string, { include?: string[] }>
}
const unsupportedManifest = JSON.parse(
  readFileSync('host/modules/connectivity/manifest_local_peer_unsupported.json', 'utf8'),
) as {
  modules: Record<string, string | string[]>
}

test('the 4 MB M5Stack target keeps the local-peer API without its implementation', () => {
  assert.deepEqual(connectivityManifest.platforms['esp32/m5stack']?.include, ['./manifest_local_peer_unsupported.json'])
  assert.equal(unsupportedManifest.modules['local-peer-capability'], './sim/local-peer-capability')
  assert.deepEqual(unsupportedManifest.modules['~'], [
    './local-peer-capability',
    './local-peer-codec',
    './local-peer-frame',
    './local-peer-radio-types',
    './local-peer-service',
    './esp32/local-peer-radio',
  ])
  assert.equal(connectivityManifest.platforms['esp32/m5stack_core2'], undefined)
})
