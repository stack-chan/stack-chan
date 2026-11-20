import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { writeAliasPackage } from '../../testing/node-alias-package.js'

const modulesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
writeAliasPackage(modulesRoot, 'local-peer-codec', resolve(modulesRoot, 'connectivity/local-peer-codec.js'))
writeAliasPackage(modulesRoot, 'local-peer-frame', resolve(modulesRoot, 'connectivity/local-peer-frame.js'))

const { BLE_LOCAL_PEER_BROADCAST_ID, BLELocalPeerRecordDecoder, BLELocalPeerRecordKind, encodeBLELocalPeerRecord } =
  await import('../ble/local-peer-record.js')

test('BLE local-peer records survive arbitrary GATT chunk boundaries', () => {
  const payload = Uint8Array.from({ length: 234 }, (_, index) => index)
  const encoded = new Uint8Array(
    encodeBLELocalPeerRecord({
      kind: BLELocalPeerRecordKind.DATA,
      authenticated: false,
      sourceId: '001122334455',
      destinationId: BLE_LOCAL_PEER_BROADCAST_ID,
      payload,
    }),
  )
  const decoder = new BLELocalPeerRecordDecoder()
  const records = []
  for (let offset = 0; offset < encoded.length; offset += 7) {
    records.push(...decoder.push(encoded.slice(offset, offset + 7).buffer))
  }
  assert.equal(records.length, 1)
  assert.equal(records[0]?.sourceId, '001122334455')
  assert.equal(records[0]?.destinationId, BLE_LOCAL_PEER_BROADCAST_ID)
  assert.deepEqual(records[0]?.payload, payload)
})

test('BLE local-peer decoder resynchronizes after malformed bytes', () => {
  const record = new Uint8Array(
    encodeBLELocalPeerRecord({
      kind: BLELocalPeerRecordKind.HELLO,
      authenticated: false,
      sourceId: 'AABBCCDDEEFF',
      destinationId: BLE_LOCAL_PEER_BROADCAST_ID,
      payload: new Uint8Array(0),
    }),
  )
  const bytes = new Uint8Array(record.byteLength + 4)
  bytes.set([0xff, 0x53, 0x00, 0x7f])
  bytes.set(record, 4)
  const decoded = new BLELocalPeerRecordDecoder().push(bytes.buffer)
  assert.equal(decoded.length, 1)
  assert.equal(decoded[0]?.kind, BLELocalPeerRecordKind.HELLO)
  assert.equal(decoded[0]?.sourceId, 'AABBCCDDEEFF')
})

test('BLE local-peer record validates authentication tag length', () => {
  assert.throws(
    () =>
      encodeBLELocalPeerRecord({
        kind: BLELocalPeerRecordKind.DATA,
        authenticated: true,
        sourceId: '001122334455',
        destinationId: 'AABBCCDDEEFF',
        payload: new Uint8Array(1),
        tag: new Uint8Array(15),
      }),
    /authentication tag/,
  )
})
