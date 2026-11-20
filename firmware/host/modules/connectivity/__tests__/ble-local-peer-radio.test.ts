import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { writeAliasPackage } from '../../testing/node-alias-package.js'

const modulesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

function installBareSpecifierPackages(): void {
  writeAliasPackage(modulesRoot, 'ble-local-peer-record', resolve(modulesRoot, 'connectivity/ble/local-peer-record.js'))
  writeAliasPackage(modulesRoot, 'crypt', resolve(modulesRoot, 'connectivity/__tests__/fakes/crypt.js'))
  writeAliasPackage(modulesRoot, 'local-peer-auth', resolve(modulesRoot, 'connectivity/local-peer-auth.js'))
  writeAliasPackage(modulesRoot, 'local-peer-codec', resolve(modulesRoot, 'connectivity/local-peer-codec.js'))
  writeAliasPackage(modulesRoot, 'local-peer-frame', resolve(modulesRoot, 'connectivity/local-peer-frame.js'))
  writeAliasPackage(modulesRoot, 'uartserver', resolve(modulesRoot, 'connectivity/__tests__/fakes/uartserver.js'))
}

test('closing a BLE local-peer radio prevents a late disconnect from restarting advertising', async () => {
  installBareSpecifierPackages()
  const [{ default: createRadio }, uartserver] = await Promise.all([
    import('../ble/local-peer-radio.js'),
    import('./fakes/uartserver.js'),
  ])
  const radio = createRadio({
    id: '001122334455',
    offlineChannel: 0,
    onReceive() {},
  })
  const server = uartserver.lastUARTServer
  assert.ok(server)

  ;(server as typeof server & { onDisconnected(): void }).onDisconnected()
  assert.equal(server.advertisingStarts.length, 1)

  radio.close()
  ;(server as typeof server & { onDisconnected(): void }).onDisconnected()
  assert.equal(server.closed, true)
  assert.equal(server.advertisingStarts.length, 1)
})
