import assert from 'node:assert/strict'
import { test } from 'node:test'
import { audioEventLayout, replayAudioEvent } from './fixture.js'

ArrayBuffer.fromString = (text) => Uint8Array.from(Buffer.from(text)).buffer
for (const size of [8192, 65536]) {
  test(`exact ${size} byte SSE event with bounded transport and silent even PCM`, async () => {
    const chunks = []
    let checks = 0
    await replayAudioEvent(
      size,
      async (bytes) => {
        assert.ok(bytes.length <= 1024)
        chunks.push(Buffer.from(bytes))
      },
      () => checks++,
    )
    const event = Buffer.concat(chunks)
    assert.equal(event.length, size)
    assert.ok(event.toString().endsWith('\n\n'))
    const json = JSON.parse(event.toString().slice(6).trim())
    const pcm = Buffer.from(json.delta.data, 'base64')
    assert.equal(pcm.length, audioEventLayout(size).pcmBytes)
    assert.equal(pcm.length % 2, 0)
    assert.ok(pcm.every((byte) => byte === 0))
    assert.equal(checks, chunks.length * 2)
  })
}
test('cancellation stops bounded replay', async () => {
  let sent = 0
  await assert.rejects(
    replayAudioEvent(
      8192,
      async () => {
        sent++
      },
      () => {
        if (sent) throw new Error('cancelled')
      },
    ),
    /cancelled/,
  )
  assert.equal(sent, 1)
})
