import assert from 'node:assert/strict'
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type StkServer from '../modules/connectivity/ble/stk-server.js'
import { writeAliasPackage, writeAliasPackageSubpath } from '../modules/testing/node-alias-package.js'
import type FakeBLEServer from './__tests__/fakes/ble-server.js'

test('STK rejects bad packets, accepts the next valid packet and ignores late events over 100 closes', async (t) => {
  const source = dirname(fileURLToPath(import.meta.url))
  const root = mkdtempSync(resolve(tmpdir(), 'stackchan-stk-server-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(resolve(root, 'package.json'), '{"type":"module"}')
  copyFileSync(resolve(source, '../modules/connectivity/ble/stk-server.js'), resolve(root, 'stk-server.js'))
  for (const name of ['bleserver', 'btutils'])
    writeAliasPackage(root, name, resolve(source, '__tests__/fakes/ble-server.js'), { hasDefaultExport: true })
  writeAliasPackageSubpath(root, 'stackchan', 'errors', resolve(source, '../../sdk/errors.js'))
  const { default: Server } = (await import(pathToFileURL(resolve(root, 'stk-server.js')).href)) as {
    default: typeof StkServer
  }
  const previous = String.fromArrayBuffer
  String.fromArrayBuffer = (data) => Buffer.from(data).toString('utf8')
  t.after(() => {
    String.fromArrayBuffer = previous
  })
  const packet = (value: string) => Uint8Array.from(Buffer.from(value)).buffer
  for (let cycle = 0; cycle < 100; cycle++) {
    const messages: unknown[] = [],
      errors: Array<{ code: string }> = []
    const server = new Server({
      onReceive: (value: unknown) => messages.push(value),
      onError: (error: { code: string }) => errors.push(error),
    }) as StkServer & FakeBLEServer
    server.onReady()
    server.onConnected(undefined)
    for (const value of [packet('{broken'), new ArrayBuffer(2049)])
      assert.doesNotThrow(() => server.onCharacteristicWritten({ name: 'stk' }, value))
    assert.deepEqual(
      errors.map((error) => error.code),
      ['INVALID_ARGUMENT', 'INVALID_ARGUMENT'],
    )
    server.onCharacteristicWritten({ name: 'stk' }, packet('{"yaw":12}'))
    assert.deepEqual(messages, [{ yaw: 12 }])
    server.close()
    server.onReady()
    server.onConnected(undefined)
    server.onDisconnected(undefined)
    server.onCharacteristicWritten({ name: 'stk' }, packet('{"yaw":99}'))
    server.close()
    assert.deepEqual(messages, [{ yaw: 12 }])
    assert.equal(server.advertising.length, 1)
    assert.equal(server.advertisingStops, 1)
    assert.equal(server.closeCalls, 1)
  }
})
