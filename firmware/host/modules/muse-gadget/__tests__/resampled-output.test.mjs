import assert from 'node:assert/strict'
import test from 'node:test'
import resamplePCM16Mono from '../../testing/fakes/pcm-resampler.ts'
import { createResampledOutput } from '../playback/resampled-output.js'

function setup() {
  const timers = new Map()
  let nextTimer = 0
  const writes = [],
    calls = [],
    states = []
  let closed = 0,
    drained = 0
  const native = {
    async write(bytes) {
      writes.push(bytes.slice())
    },
    async drain() {
      drained++
    },
    setVolume(gain) {
      calls.push(['volume', gain])
    },
    close() {
      closed++
    },
  }
  const adapter = createResampledOutput({
    minimumOutputBytes: 4092,
    setTimer(callback, ms) {
      timers.set(++nextTimer, { callback, ms })
      return nextTimer
    },
    clearTimer(id) {
      timers.delete(id)
    },
    openOutput(...args) {
      calls.push(args)
      return native
    },
    resample(input, offset, count, output, sourceRate, targetRate, state) {
      assert.equal(sourceRate, 24000)
      assert.equal(targetRate, 16000)
      assert.ok(Number.isInteger(offset))
      states.push(state)
      return resamplePCM16Mono(input, offset, count, output, sourceRate, targetRate, state)
    },
  })
  return {
    adapter,
    writes,
    calls,
    states,
    native,
    timers,
    fireTimer() {
      for (const [id, job] of [...timers]) {
        timers.delete(id)
        job.callback()
      }
    },
    counts: () => ({ closed, drained }),
  }
}

test('24 kHz speech uses 16 kHz hardware with bounded chunks and source-rate accounting', async () => {
  const f = setup(),
    output = f.adapter.openOutput(24000, 0.25, 24576)
  const pcm = new Int16Array(12000)
  for (let i = 0; i < pcm.length; i++) pcm[i] = i
  const accepted = []
  await output.write(new Uint8Array(pcm.buffer), (count) => accepted.push(count))
  await output.drain()
  assert.equal(f.calls[0][0], 16000)
  assert.ok(f.writes.every((bytes) => bytes.length <= 4092))
  assert.equal(
    f.writes.reduce((sum, bytes) => sum + bytes.length, 0),
    16000,
  )
  assert.equal(
    accepted.reduce((sum, size) => sum + size, 0),
    24000,
  )
  assert.equal(output.frames, 12000)
  assert.ok(f.states.every((state) => state === f.states[0]))
  assert.equal(f.counts().drained, 1)
  await output.drain()
  assert.equal(f.counts().drained, 1)
  output.close()
  output.close()
  assert.equal(f.counts().closed, 1)
  await assert.rejects(output.write(new Uint8Array(2)), { code: 'cancelled' })
})

test('chunk boundaries preserve samples and accept sliced input buffers', async () => {
  async function render(sizes) {
    const f = setup(),
      output = f.adapter.openOutput(24000, 1, 24576)
    const pcm = new Int16Array(400)
    for (let i = 0; i < pcm.length; i++) pcm[i] = i * 10
    let offset = 0
    for (const size of sizes) {
      await output.write(new Uint8Array(pcm.buffer, offset * 2, size * 2))
      offset += size
    }
    await output.drain()
    return f.writes.flatMap((bytes) => [...new Int16Array(bytes.buffer)])
  }
  assert.deepEqual(await render([1, 2, 100, 97, 200]), await render([400]))
})

test('16 kHz passes through, unsupported formats reject before opening hardware', () => {
  const f = setup()
  assert.equal(f.adapter.openOutput(16000, 1, 8192), f.native)
  assert.throws(() => f.adapter.openOutput(48000, 1, 8192), RangeError)
  assert.equal(f.calls.length, 1)
})

test('odd byte offsets are aligned before calling the native resampler', async () => {
  const f = setup(),
    output = f.adapter.openOutput(24000, 1, 8192)
  const storage = new Uint8Array([255, 0, 0, 10, 0, 20, 0])
  await output.write(storage.subarray(1))
  await output.drain()
  assert.equal(output.frames, 3)
  assert.deepEqual(
    f.writes.flatMap((bytes) => [...new Int16Array(bytes.buffer)]),
    [0, 15],
  )
})

test('pending native writes cannot be drained or overwritten and close rejects continuation', async () => {
  const f = setup()
  let release
  f.native.write = () =>
    new Promise((resolve) => {
      release = resolve
    })
  const output = f.adapter.openOutput(24000, 1, 8192)
  const pending = output.write(new Uint8Array(4092))
  await assert.rejects(output.write(new Uint8Array(2)), RangeError)
  await assert.rejects(output.drain(), /write still pending/)
  output.close()
  release()
  await assert.rejects(pending, { code: 'cancelled' })
  assert.equal(output.frames, 0)
})

test('startup mode preserves equal PCM prefill at 24k and 16k and rejects insufficient total stage/scratch budget', () => {
  const f = setup()
  f.adapter.openOutput(24000, 0, 17920, undefined, 3)
  assert.equal(f.calls[0][4], 3)
  f.adapter.openOutput(16000, 0, 17920, undefined, 3)
  assert.equal(f.calls[1][4], 3)
  assert.throws(() => f.adapter.openOutput(24000, 0, 16367, undefined, 3), RangeError)
  assert.throws(() => f.adapter.openOutput(24000, 0, 17920, undefined, 2), RangeError)
  assert.equal(f.calls.length, 2)
})

test('reserve3 rejects unaligned borrowed input instead of allocating a hidden PCM copy', async () => {
  const f = setup(),
    output = f.adapter.openOutput(24000, 0, 17920, undefined, 3)
  await assert.rejects(output.write(new Uint8Array(5).subarray(1)), RangeError)
  assert.equal(f.writes.length, 0)
  output.close()
})
