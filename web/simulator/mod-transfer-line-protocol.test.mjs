import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  crc32,
  createConsoleModTransferSession,
  decodeConsoleResponseLine,
  encodeConsoleCommandLine,
} from './mod-transfer-line-protocol.mjs'

describe('console MOD transfer protocol', () => {
  it('encodes browser commands as line-oriented Moddable CLI input and decodes prefixed responses', () => {
    const line = encodeConsoleCommandLine({ type: 'hello', name: 'look_around.xsa', size: 3, crc32: '55bc801d' })
    assert.match(line, /^modrx \{.*\}\r\n$/)
    assert.equal(JSON.parse(line.slice('modrx '.length)).type, 'hello')

    assert.deepEqual(decodeConsoleResponseLine('> echoed input'), undefined)
    assert.deepEqual(decodeConsoleResponseLine('MODX {"type":"ready","maxChunkSize":384}'), {
      type: 'ready',
      maxChunkSize: 384,
    })
  })

  it('computes deterministic CRC32 values shared by build summary and firmware receiver', () => {
    assert.equal(crc32(new TextEncoder().encode('123456789')), 'cbf43926')
  })

  it('runs hello/start/chunk/commit over a line transport', async () => {
    const written = []
    const responses = [
      'garbage echo',
      'MODX {"type":"ready","partitionSize":4096,"eraseBlockSize":4096,"maxChunkSize":4}',
      'MODX {"type":"erased","sectors":1}',
      'MODX {"type":"ack","seq":0,"offset":0}',
      'MODX {"type":"ack","seq":1,"offset":4}',
      'MODX {"type":"done","size":6,"crc32":"81f67724"}',
    ]
    const transport = {
      async open() {},
      async writeLine(line) {
        written.push(line)
      },
      async readLine() {
        return responses.shift()
      },
      async close() {},
    }

    const session = createConsoleModTransferSession({ transport, chunkSize: 4 })
    const result = await session.transfer({ name: 'sample.xsa', bytes: new Uint8Array([1, 2, 3, 4, 5, 6]) })

    assert.equal(result.status, 'done')
    assert.equal(result.size, 6)
    assert.equal(result.crc32, '81f67724')
    assert.equal(written.length, 5)
    assert.match(written[0], /^modrx /)
    assert.match(written[2], /"type":"chunk"/)
    assert.match(written[2], /"data":"AQIDBA=="/)
  })
})
