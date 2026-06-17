import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  createBleSerialTransportDescriptor,
  createMockByteTransport,
  createWebSerialLineTransport,
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

  it('opens Web Serial and filters Moddable console output down to MODX responses', async () => {
    const written = []
    const chunks = [new TextEncoder().encode('Moddable Command Line Interface\r\n> echo\r\nMODX {"type":"ready"}\r\n')]
    const port = {
      async open(options) {
        port.options = options
      },
      readable: {
        getReader() {
          return {
            async read() {
              return chunks.length ? { value: chunks.shift(), done: false } : { done: true }
            },
            releaseLock() {},
          }
        },
      },
      writable: {
        getWriter() {
          return {
            async write(bytes) {
              written.push(new TextDecoder().decode(bytes))
            },
            releaseLock() {},
          }
        },
      },
      async close() {
        port.closed = true
      },
    }
    const transport = createWebSerialLineTransport({ serial: { async requestPort() { return port } }, baudRate: 115200 })
    await transport.open()
    await transport.writeLine('modrx {"type":"hello"}\r\n')
    assert.equal(await transport.readLine(), 'MODX {"type":"ready"}')
    await transport.close()
    assert.deepEqual(port.options, { baudRate: 115200 })
    assert.equal(written[0], 'modrx {"type":"hello"}\r\n')
    assert.equal(port.closed, true)
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
