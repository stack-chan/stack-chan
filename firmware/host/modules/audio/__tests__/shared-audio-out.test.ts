import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSharedAudioOutClass, type ModernAudioOutOptions } from '../shared-audio-out.js'

class FakePhysicalAudioOut {
  static readonly instances: FakePhysicalAudioOut[] = []
  readonly sampleRate: number
  readonly bitsPerSample: number
  readonly channels: number
  readonly writes: Uint8Array[] = []
  readonly onWritable?: (size: number) => void
  format = 'buffer'
  volume = 1
  starts = 0
  stops = 0
  closes = 0

  constructor(options: ModernAudioOutOptions = {}) {
    this.sampleRate = options.sampleRate ?? 24_000
    this.bitsPerSample = options.bitsPerSample ?? 16
    this.channels = options.channels ?? options.numChannels ?? 1
    this.onWritable = options.onWritable
    FakePhysicalAudioOut.instances.push(this)
  }

  write(samples: ArrayBuffer | ArrayBufferView): void {
    const bytes = ArrayBuffer.isView(samples)
      ? new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength)
      : new Uint8Array(samples)
    this.writes.push(new Uint8Array(bytes))
  }

  start(): void {
    this.starts += 1
  }

  stop(): void {
    this.stops += 1
  }

  close(): void {
    this.closes += 1
  }

  writable(size: number): void {
    this.onWritable?.call(this, size)
  }

  static reset(): void {
    FakePhysicalAudioOut.instances.length = 0
  }
}

function pcm(...samples: number[]): Int16Array {
  return Int16Array.from(samples)
}

function writtenSamples(output: FakePhysicalAudioOut): number[] {
  return output.writes.flatMap((bytes) => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const samples: number[] = []
    for (let offset = 0; offset < bytes.byteLength; offset += 2) samples.push(view.getInt16(offset, true))
    return samples
  })
}

test('shared AudioOut mixes tracks with volume and saturates PCM16', () => {
  FakePhysicalAudioOut.reset()
  const SharedAudioOut = createSharedAudioOutClass(FakePhysicalAudioOut)
  const first = new SharedAudioOut({ sampleRate: 24_000, bitsPerSample: 16, channels: 1 })
  const second = new SharedAudioOut({ sampleRate: 24_000, bitsPerSample: 16, channels: 1 })
  first.volume = 1
  second.volume = 0.5
  first.start()
  second.start()

  const physical = FakePhysicalAudioOut.instances[0]
  physical.writable(4)
  first.write(pcm(20_000, -20_000))
  second.write(pcm(30_000, -30_000))
  physical.writable(4)

  assert.equal(FakePhysicalAudioOut.instances.length, 1)
  assert.deepEqual(writtenSamples(physical).slice(-2), [32_767, -32_768])
  assert.equal(physical.starts, 1)
  first.close()
  assert.equal(physical.closes, 0)
  second.close()
  assert.equal(physical.stops, 1)
  assert.equal(physical.closes, 1)
})

test('a track may write after its writable callback and is mixed on the next cycle', () => {
  FakePhysicalAudioOut.reset()
  const SharedAudioOut = createSharedAudioOutClass(FakePhysicalAudioOut)
  const track = new SharedAudioOut({ sampleRate: 24_000, bitsPerSample: 16, channels: 1 })
  track.start()
  const physical = FakePhysicalAudioOut.instances[0]

  physical.writable(4)
  assert.deepEqual(writtenSamples(physical), [0, 0])
  track.write(pcm(123, -456))
  physical.writable(4)
  assert.deepEqual(writtenSamples(physical).slice(-2), [123, -456])
  track.close()
})

test('Async tracks accept queued writes and invoke callbacks after mixing', () => {
  FakePhysicalAudioOut.reset()
  const SharedAudioOut = createSharedAudioOutClass(FakePhysicalAudioOut)
  const track = new SharedAudioOut.Async({ sampleRate: 24_000, bitsPerSample: 16, channels: 1 })
  let callbackError: unknown = Symbol('not called')
  track.write(pcm(321, -654), (error) => {
    callbackError = error
  })
  track.start()
  const physical = FakePhysicalAudioOut.instances[0]
  physical.writable(4)

  assert.equal(callbackError, undefined)
  assert.deepEqual(writtenSamples(physical), [321, -654])
  track.close()
})

test('shared AudioOut rejects format conflicts and more than four tracks', () => {
  FakePhysicalAudioOut.reset()
  const SharedAudioOut = createSharedAudioOutClass(FakePhysicalAudioOut)
  const tracks = Array.from(
    { length: 4 },
    () => new SharedAudioOut({ sampleRate: 24_000, bitsPerSample: 16, channels: 1 }),
  )

  assert.throws(() => new SharedAudioOut({ sampleRate: 16_000 }), /sample rate conflict/)
  assert.throws(() => new SharedAudioOut({ bitsPerSample: 8 }), /bits-per-sample conflict/)
  assert.throws(() => new SharedAudioOut({ channels: 2 }), /channel conflict/)
  assert.throws(() => new SharedAudioOut(), /too many shared AudioOut tracks/)

  for (const track of tracks) track.close()
})
