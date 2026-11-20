import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { writeAliasPackage } from '../../testing/node-alias-package.js'
import FakeWiFi, { getFakeWiFiInstances, resetFakeWiFi } from './fakes/ecma-wifi.js'

function installBareSpecifierPackages(): void {
  const modulesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  writeAliasPackage(modulesRoot, 'ecma-wifi', resolve(modulesRoot, 'connectivity/__tests__/fakes/ecma-wifi.js'), {
    hasDefaultExport: true,
  })
  writeAliasPackage(modulesRoot, 'wifi-scan-types', resolve(modulesRoot, 'connectivity/wifi-scan-types.js'))
}

test('scanWiFiNetworks constructs ECMA-419 Wi-Fi with options and reports scan results', async () => {
  installBareSpecifierPackages()
  resetFakeWiFi()
  FakeWiFi.scanResults = [{ ssid: 'StackChan-Open' }, { ssid: 'Workshop-WiFi' }]
  const { scanWiFiNetworks } = await import('../wifi-scan.js')
  const found: string[] = []
  let completed = false

  scanWiFiNetworks({
    onFound: (item) => found.push(item.ssid),
    onComplete: () => {
      completed = true
    },
  })

  assert.deepEqual(found, ['StackChan-Open', 'Workshop-WiFi'])
  assert.equal(completed, true)
  assert.equal(FakeWiFi.scanCallCount, 1)
  assert.equal(getFakeWiFiInstances()[0]?.closed, true)
})
