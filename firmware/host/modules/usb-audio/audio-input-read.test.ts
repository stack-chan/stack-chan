import assert from 'node:assert/strict'
import test from 'node:test'
import { readAudioInputChunk } from './audio-input-read.js'

test('audio input reads a bounded even chunk through the native allocator', () => {
  const requested: number[] = []
  const chunk = readAudioInputChunk(
    {
      read(byteLength) {
        assert.notEqual(byteLength, undefined)
        requested.push(byteLength)
        return new ArrayBuffer(byteLength)
      },
    },
    1_000_001,
  )

  assert.deepEqual(requested, [2048])
  assert.equal(chunk?.byteLength, 2048)
})

test('audio input ignores reports without a complete PCM16 sample', () => {
  let reads = 0
  const input = {
    read() {
      reads += 1
      return new ArrayBuffer(0)
    },
  }

  assert.equal(readAudioInputChunk(input, 0), undefined)
  assert.equal(readAudioInputChunk(input, 1), undefined)
  assert.equal(reads, 0)
})

test('audio input retries the current native availability after a stale size error', () => {
  const requested: Array<number | undefined> = []
  const chunk = readAudioInputChunk(
    {
      read(byteLength) {
        requested.push(byteLength)
        if (byteLength !== undefined) throw new Error('invalid size')
        return new ArrayBuffer(640)
      },
    },
    2048,
  )

  assert.deepEqual(requested, [2048, undefined])
  assert.equal(chunk?.byteLength, 640)
})

test('audio input preserves the first error when the fallback also fails', () => {
  const initial = new Error('initial read failed')
  let reads = 0

  assert.throws(
    () =>
      readAudioInputChunk(
        {
          read() {
            reads += 1
            if (reads === 1) throw initial
            throw new Error('fallback read failed')
          },
        },
        640,
      ),
    initial,
  )
  assert.equal(reads, 2)
})
