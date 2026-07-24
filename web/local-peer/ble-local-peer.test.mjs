import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { test } from 'node:test'

import { BLELocalPeerCapability, BLELocalPeerRecordDecoder, encodeBLELocalPeerRecord } from './ble-local-peer.mjs'

const UART_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e'
const UART_RX_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'
const UART_TX_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'

function connectedBluetooth(writeValueWithResponse) {
  const rx = { writeValueWithResponse }
  const tx = {
    addEventListener() {},
    async startNotifications() {},
  }
  const service = {
    async getCharacteristic(uuid) {
      if (uuid === UART_RX_UUID) return rx
      if (uuid === UART_TX_UUID) return tx
      throw new Error(`unexpected characteristic ${uuid}`)
    },
  }
  const device = {
    id: 'connected-stackchan',
    name: 'STK',
    addEventListener() {},
    gatt: {
      async connect() {
        return {
          async getPrimaryService(uuid) {
            assert.equal(uuid, UART_SERVICE_UUID)
            return service
          },
        }
      },
      disconnect() {},
    },
  }
  return {
    async requestDevice() {
      return device
    },
  }
}

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

  await assert.rejects(capability.open({ transport: 'ble', service: 'tech.stackchan.test' }), /chooser stopped/)
  assert.deepEqual(chooserOptions, {
    filters: [{ services: [UART_SERVICE_UUID] }],
    optionalServices: [UART_SERVICE_UUID],
  })
})

test('BLE local-peer reuses the only previously permitted STK without reopening the chooser', async () => {
  let chooserCalled = false
  let gattCalled = false
  const device = {
    id: 'permitted-stackchan',
    name: 'STK',
    addEventListener() {},
    gatt: {
      async connect() {
        gattCalled = true
        throw new Error('permitted device reached')
      },
      disconnect() {},
    },
  }
  const bluetooth = {
    async getDevices() {
      return [{ id: 'unrelated-device', name: 'Sensor' }, device]
    },
    async requestDevice() {
      chooserCalled = true
      throw new Error('chooser should not open')
    },
  }
  const stored = new Map([['stackchan.localPeer.id', '001122334455']])
  const storage = {
    getItem(key) {
      return stored.get(key)
    },
    setItem(key, value) {
      stored.set(key, value)
    },
  }
  const capability = new BLELocalPeerCapability({ bluetooth, crypto: webcrypto, storage })

  await assert.rejects(
    capability.open({ transport: 'ble', service: 'tech.stackchan.test' }),
    /permitted device reached/
  )
  assert.equal(gattCalled, true)
  assert.equal(chooserCalled, false)
  assert.equal(stored.get('stackchan.localPeer.bleDevice'), device.id)
})

test('BLE local-peer sends a complete tracking record in one preferred-MTU write', async () => {
  const writes = []
  const bluetooth = connectedBluetooth(async (value) => {
    writes.push(new Uint8Array(value))
  })
  const capability = new BLELocalPeerCapability({ bluetooth, crypto: webcrypto })

  const session = await capability.open({ transport: 'ble', service: 'tech.stackchan.demos.mediapipe' })
  writes.length = 0
  await session.broadcast('tracking.update', [4, 7, 750, -1571, 1, -128, 128, 3, 7, 128, 128, 3, 7, 0, 255, 128])

  assert.equal(writes.length, 1)
  assert.ok(writes[0].byteLength > 60)
  assert.ok(writes[0].byteLength <= 244)
  session.close()
})

test('BLE local-peer falls back from the preferred MTU to 60-byte writes for an older host', async () => {
  const attempts = []
  const bluetooth = connectedBluetooth(async (value) => {
    const bytes = new Uint8Array(value)
    attempts.push(bytes.byteLength)
    if (bytes.byteLength > 60) throw new Error('characteristic accepts at most 60 bytes')
  })
  const capability = new BLELocalPeerCapability({ bluetooth, crypto: webcrypto })

  const session = await capability.open({ transport: 'ble', service: 'tech.stackchan.demos.mediapipe' })
  attempts.length = 0
  await session.broadcast('tracking.update', [4, 7, 750, -1571, 1, -128, 128, 3, 7, 128, 128, 3, 7, 0, 255, 128])

  assert.ok(attempts.length > 1)
  assert.ok(attempts.every((length) => length <= 60))
  session.close()
})

test('BLE local-peer falls back through 60 to 20-byte writes for a legacy MTU', async () => {
  const attempts = []
  const bluetooth = connectedBluetooth(async (value) => {
    const bytes = new Uint8Array(value)
    attempts.push(bytes.byteLength)
    if (bytes.byteLength > 20) throw new Error('MTU only accepts 20 bytes')
  })
  const capability = new BLELocalPeerCapability({ bluetooth, crypto: webcrypto })

  const session = await capability.open({ transport: 'ble', service: 'tech.stackchan.test' })

  assert.deepEqual(attempts.slice(0, 4), [22, 22, 20, 2])
  assert.ok(attempts.slice(2).every((length) => length <= 20))
  session.close()
})
