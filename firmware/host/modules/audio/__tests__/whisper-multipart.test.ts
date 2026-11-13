import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createMultipartUpload } from '../whisper-multipart.js'

test('multipart upload respects each TLS notification across the boundary and audio views', () => {
  const audio = Uint8Array.from({ length: 9000 }, (_, i) => i % 251)
  const parts = [Uint8Array.of(99), new ArrayBuffer(0), audio.subarray(12, 8800), Uint8Array.of(1, 2).buffer]
  const upload = createMultipartUpload(parts)
  const received: number[] = []
  for (const available of [0, 1400, 8000, 3400, 4096, 37, 16]) {
    let credit = available
    let writes = 0
    upload.write(
      {
        write(data) {
          assert.ok(data.byteLength <= credit)
          assert.ok(data.byteLength <= 4096)
          assert.equal(++writes, 1)
          const view = ArrayBuffer.isView(data)
            ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
            : new Uint8Array(data as ArrayBuffer)
          received.push(...view)
          credit -= view.length + 32
          return Math.max(0, credit)
        },
      },
      available,
    )
  }
  assert.equal(received.length, upload.byteLength)
  assert.deepEqual(received, [99, ...audio.subarray(12, 8800), 1, 2])
})
