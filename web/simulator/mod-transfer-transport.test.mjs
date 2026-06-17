import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  createBleSerialTransportDescriptor,
  createMockByteTransport,
  createWebSerialTransportDescriptor,
  fragmentBlePayload,
} from './mod-transfer-transport.mjs'

describe('MOD transfer byte transports', () => {
  it('describes Web Serial as the preferred desktop transport', () => {
    assert.deepEqual(createWebSerialTransportDescriptor(), {
      id: 'web-serial',
      label: 'Web Serial',
      requiresUserGesture: true,
      preferredChunkSize: 1024,
      capabilities: ['full-duplex-byte-stream', 'disconnect-events'],
    })
  })

  it('records bytes written through the transport contract and supports queued reads', async () => {
    const transport = createMockByteTransport({ id: 'web-serial', incoming: [[0x61], [0x62, 0x63]] })

    await transport.open()
    await transport.write(new Uint8Array([1, 2, 3]))

    assert.deepEqual(Array.from(await transport.read()), [0x61])
    assert.deepEqual(Array.from(await transport.read()), [0x62, 0x63])
    assert.equal(await transport.read(), null)
    assert.deepEqual(transport.written.map((chunk) => Array.from(chunk)), [[1, 2, 3]])

    await transport.close()
    assert.equal(transport.isOpen, false)
  })

  it('describes BLE Serial as a mobile fallback with notification acknowledgements', () => {
    assert.deepEqual(createBleSerialTransportDescriptor({ serviceUuid: 'stackchan-service' }), {
      id: 'ble-serial',
      label: 'BLE Serial',
      requiresUserGesture: true,
      preferredChunkSize: 160,
      serviceUuid: 'stackchan-service',
      capabilities: ['gatt-characteristics', 'rx-notifications', 'fragmented-writes'],
    })
  })

  it('fragments BLE payloads under the negotiated write size', () => {
    const fragments = fragmentBlePayload(new Uint8Array([1, 2, 3, 4, 5]), 2)

    assert.deepEqual(
      fragments.map((fragment) => Array.from(fragment)),
      [[1, 2], [3, 4], [5]]
    )
  })
})
