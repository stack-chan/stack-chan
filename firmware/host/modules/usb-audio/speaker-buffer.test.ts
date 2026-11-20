import assert from 'node:assert/strict'
import test from 'node:test'
import { SpeakerPlaybackBuffer } from './speaker-buffer.js'

function pcm16(...samples: number[]): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2)
  const view = new DataView(bytes.buffer)
  samples.forEach((sample, index) => {
    view.setInt16(index * 2, sample, true)
  })
  return bytes
}

test('SpeakerPlaybackBuffer retains AudioOut space until USB PCM arrives', () => {
  const buffer = new SpeakerPlaybackBuffer()
  const writes: number[][] = []
  const captions: string[] = []

  buffer.setWritableBytes(8)
  assert.deepEqual(
    buffer.drain(
      (chunk) => writes.push(Array.from(chunk)),
      (text) => captions.push(text),
    ),
    {
      consumedBytes: 0,
      power: 0,
    },
  )
  assert.equal(buffer.writableBytes, 8)

  buffer.enqueueCaption('hello')
  buffer.enqueuePcm(pcm16(1000, -1000, 2000, -2000))
  const result = buffer.drain(
    (chunk) => writes.push(Array.from(chunk)),
    (text) => captions.push(text),
  )
  assert.equal(result.consumedBytes, 8)
  assert.equal(Math.round(result.power), 1581)
  assert.equal(buffer.writableBytes, 0)
  assert.equal(buffer.pcmBytes, 0)
  assert.deepEqual(captions, ['hello'])
  assert.equal(writes.length, 1)
})

test('SpeakerPlaybackBuffer rejects empty and partial PCM samples', () => {
  const buffer = new SpeakerPlaybackBuffer()

  assert.throws(() => buffer.enqueuePcm(new Uint8Array(0)), /complete 16-bit samples/)
  assert.throws(() => buffer.enqueuePcm(Uint8Array.of(1)), /complete 16-bit samples/)
  assert.equal(buffer.pcmBytes, 0)
})

test('SpeakerPlaybackBuffer applies a caption only when its following PCM can be written', () => {
  const buffer = new SpeakerPlaybackBuffer()
  const events: string[] = []

  buffer.enqueueCaption('first')
  buffer.setWritableBytes(4)
  buffer.drain(
    () => events.push('pcm'),
    (text) => events.push(text),
  )
  assert.deepEqual(events, [])
  assert.equal(buffer.captionCount, 1)
  assert.equal(buffer.writableBytes, 4)

  buffer.enqueuePcm(pcm16(1, 2))
  buffer.drain(
    () => events.push('pcm'),
    (text) => events.push(text),
  )
  assert.deepEqual(events, ['first', 'pcm'])
  assert.equal(buffer.captionCount, 0)
})

test('SpeakerPlaybackBuffer preserves PCM and caption order across partial drains', () => {
  const buffer = new SpeakerPlaybackBuffer()
  const events: string[] = []
  buffer.enqueuePcm(pcm16(1, 2))
  buffer.enqueueCaption('second')
  buffer.enqueuePcm(pcm16(3, 4))

  buffer.setWritableBytes(6)
  const first = buffer.drain(
    (chunk) => events.push(`pcm:${chunk.byteLength}`),
    (text) => events.push(`caption:${text}`),
  )
  assert.equal(first.consumedBytes, 6)
  assert.equal(buffer.pcmBytes, 2)
  assert.deepEqual(events, ['pcm:4', 'caption:second', 'pcm:2'])

  buffer.setWritableBytes(2)
  const second = buffer.drain(
    (chunk) => events.push(`pcm:${chunk.byteLength}`),
    (text) => events.push(`caption:${text}`),
  )
  assert.equal(second.consumedBytes, 2)
  assert.equal(buffer.pcmBytes, 0)
  assert.deepEqual(events, ['pcm:4', 'caption:second', 'pcm:2', 'pcm:2'])
})
