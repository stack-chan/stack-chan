import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createMockByteTransport } from './mod-transfer-transport.mjs'
import { createTransferPlan, runMockModTransfer } from './mod-transfer-protocol.mjs'

describe('MOD transfer protocol', () => {
  it('splits an artifact into ordered chunks capped by the device ready size', () => {
    const plan = createTransferPlan({
      artifactName: 'sample.xsa',
      artifactBytes: new Uint8Array([1, 2, 3, 4, 5]),
      sha256: 'b'.repeat(64),
      requestedChunkSize: 4,
      deviceMaxChunkSize: 2,
    })

    assert.equal(plan.artifactName, 'sample.xsa')
    assert.equal(plan.chunkSize, 2)
    assert.deepEqual(
      plan.chunks.map(({ sequence, offset, bytes }) => ({ sequence, offset, bytes: Array.from(bytes) })),
      [
        { sequence: 0, offset: 0, bytes: [1, 2] },
        { sequence: 1, offset: 2, bytes: [3, 4] },
        { sequence: 2, offset: 4, bytes: [5] },
      ]
    )
  })

  it('retries a nacked chunk without rebuilding the artifact', async () => {
    const transport = createMockByteTransport({
      id: 'web-serial',
      incoming: [
        ['ready', 2],
        ['ack', 0],
        ['nack', 1],
        ['ack', 1],
        ['ack', 'commit'],
      ].map((message) => new TextEncoder().encode(JSON.stringify(message))),
    })

    const result = await runMockModTransfer({
      transport,
      artifactName: 'sample.xsa',
      artifactBytes: new Uint8Array([9, 8, 7, 6]),
      sha256: 'c'.repeat(64),
      requestedChunkSize: 2,
    })

    assert.equal(result.status, 'done')
    assert.equal(result.retries, 1)
    assert.deepEqual(
      result.events.map((event) => event.type),
      ['hello', 'ready', 'chunk', 'ack', 'chunk', 'nack', 'chunk', 'ack', 'commit', 'done']
    )
  })
})
