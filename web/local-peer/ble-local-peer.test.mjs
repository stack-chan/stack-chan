import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { test } from 'node:test'

import { BLELocalPeerCapability, BLELocalPeerRecordDecoder, encodeBLELocalPeerRecord } from './ble-local-peer.mjs'

const UART_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e'

test('BLE local-peer web codec reassembles 20-byte GATT chunks', async () => {
  const payload = Uint8Array.from({ length: 234 }, (_, index) => index)
  const encoded = await encodeBLELocalPeerRecord(
    {
      kind: 2,
      authenticated: false,
      sourceId: '001122334455',
      destinationId: 'FFFFFFFFFFFF',
      payload,
    },
    undefined,
    webcrypto
  )
  const decoder = new BLELocalPeerRecordDecoder()
  const records = []
  for (let offset = 0; offset < encoded.byteLength; offset += 20) {
    records.push(...decoder.push(encoded.slice(offset, offset + 20)))
  }
  assert.equal(records.length, 1)
  assert.deepEqual(records[0]?.payload, payload)
})

test('BLE local-peer authentication covers source and destination identities', async () => {
  const key = new Uint8Array(
    await webcrypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode('stackchan-local-peer-auth-v1:correct horse battery staple')
    )
  )
  const encoded = await encodeBLELocalPeerRecord(
    {
      kind: 2,
      authenticated: true,
      sourceId: '001122334455',
      destinationId: 'AABBCCDDEEFF',
      payload: Uint8Array.of(1, 2, 3),
    },
    key,
    webcrypto
  )
  const [record] = new BLELocalPeerRecordDecoder().push(encoded)
  assert.equal(record.authenticated, true)
  assert.equal(record.tag.byteLength, 16)
  assert.equal(Buffer.from(record.tag).toString('hex'), 'c146beea7bcde4b7933b3a74434b0bfb')
})

test('BLE local-peer chooser discovers the UART service without depending on a long device name', async () => {
  let chooserOptions
  const bluetooth = {
    async requestDevice(options) {
      chooserOptions = options
      throw new Error('chooser stopped')
    },
  }
  const storage = {
    getItem() {
      return '001122334455'
    },
    setItem() {},
  }
  const capability = new BLELocalPeerCapability({ bluetooth, crypto: webcrypto, storage })

  await assert.rejects(
    capability.open({ transport: 'ble', service: 'tech.stackchan.test' }),
    /chooser stopped/
  )
  assert.deepEqual(chooserOptions, {
    filters: [{ services: [UART_SERVICE_UUID] }],
    optionalServices: [UART_SERVICE_UUID],
  })
})
