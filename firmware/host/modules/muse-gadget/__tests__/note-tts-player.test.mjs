import assert from 'node:assert/strict'
import test from 'node:test'
import { id3Size } from '../../audio/mp3-metadata.js'
import resample from '../../testing/fakes/pcm-resampler.ts'
import { createMuseNotePlayer } from '../note-tts-player.js'

const deferred = () => {
  let resolve, reject
  const promise = new Promise((a, b) => {
    resolve = a
    reject = b
  })
  return { promise, resolve, reject }
}
const tick = () => new Promise((resolve) => setImmediate(resolve))

function fixture(overrides = {}) {
  const controller = new AbortController(),
    done = deferred(),
    writes = [],
    fences = [],
    phases = []
  let decoderClosed = 0,
    linkClosed = 0,
    decodedFrames = 0,
    begun = 0,
    finished = 0
  let bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer
  const deps = {
    Decoder: class {
      decode(input, output) {
        decodedFrames++
        new Int16Array(output).set([input[0], input[1], input[2], input[3]])
        output.samples = 4
        output.sampleRate = 24000
        return input.length
      }
      close() {
        decoderClosed++
      }
    },
    scan(_bytes, position) {
      return { position, length: 4, sampleRate: 24000, channels: 1 }
    },
    id3Size,
    resample(input, _offset, count, output, sourceRate, targetRate, state) {
      assert.equal(sourceRate, 24000)
      assert.equal(targetRate, 16000)
      phases.push(state[0])
      const samples = new Int16Array(input),
        out = new Int16Array(output)
      let n = 0
      for (let i = 0; i < count; i++) {
        if (state[0] % 3 !== 2) out[n++] = samples[i]
        state[0]++
      }
      return n
    },
    createPcmSource() {
      return {
        output: {},
        async push(chunk) {
          writes.push([...new Int16Array(chunk.buffer, chunk.byteOffset, chunk.byteLength / 2)])
        },
        end(error) {
          if (error) done.reject(error)
          else done.resolve()
        },
      }
    },
    ...overrides,
  }
  const media = {
    output: {
      budget: { maxBufferedBytes: 6400, maxBufferedMs: 200 },
      begin(_id, generation) {
        begun++
        assert.equal(generation, 7)
        return {}
      },
      async finish(id) {
        finished++
        return { outputId: id, generation: 7, state: 'played' }
      },
      async fence(generation) {
        fences.push(generation)
        return []
      },
    },
    media: {
      async connect() {
        return {
          done: done.promise,
          async close() {
            linkClosed++
          },
        }
      },
    },
  }
  const play = createMuseNotePlayer(deps)
  return {
    controller,
    writes,
    fences,
    phases,
    media,
    done,
    setBytes(value) {
      bytes = value
    },
    run(options = {}) {
      return play(
        { id: 'reply' },
        {
          backend: {
            async readTts() {
              return bytes
            },
          },
          media,
          signal: controller.signal,
          generation: 7,
          ...options,
        },
      )
    },
    stats() {
      return { decoderClosed, linkClosed, decodedFrames, begun, finished }
    },
  }
}

test('24 kHz frames use continuous resampler state and finish a 16 kHz playback receipt', async () => {
  const f = fixture()
  const receipts = await f.run()
  assert.deepEqual(f.writes, [
    [1, 2, 4],
    [5, 7, 8],
  ])
  assert.deepEqual(f.phases, [0, 4])
  assert.equal(receipts[0].state, 'played')
  assert.deepEqual(f.stats(), { decoderClosed: 1, linkClosed: 1, decodedFrames: 2, begun: 1, finished: 1 })
  assert.equal(f.fences.length, 0)
})

test('existing linear resampler preserves phase across frames and flushes only the final tail', async () => {
  const f = fixture({ resample })
  await f.run()
  assert.deepEqual(f.writes.flat(), [1, 3, 4, 6, 7, 8])
})

test('decoder does not advance until previous PCM is consumed', async () => {
  const gate = deferred()
  const f = fixture({
    createPcmSource() {
      return {
        output: {},
        push() {
          return gate.promise
        },
        end() {
          f.done.resolve()
        },
      }
    },
  })
  const pending = f.run()
  await tick()
  assert.equal(f.stats().decodedFrames, 1)
  gate.resolve()
  await pending
  assert.equal(f.stats().decodedFrames, 2)
})

test('abort during backpressure fences playback and closes decoder/link', async () => {
  const never = new Promise(() => {})
  const f = fixture({
    createPcmSource() {
      return {
        output: {},
        push() {
          return never
        },
        end() {
          f.done.resolve()
        },
      }
    },
  })
  const pending = f.run()
  await tick()
  f.controller.abort()
  await assert.rejects(pending, { code: 'cancelled' })
  assert.deepEqual(f.fences, [8])
  assert.equal(f.stats().decoderClosed, 1)
  assert.equal(f.stats().linkClosed, 1)
  assert.equal(f.stats().finished, 0)
})

test('late media connection after abort is closed and never decoded', async () => {
  const connecting = deferred(),
    f = fixture()
  let closed = 0
  f.media.media.connect = () => connecting.promise
  const pending = f.run()
  await tick()
  f.controller.abort()
  connecting.resolve({
    done: f.done.promise,
    async close() {
      closed++
    },
  })
  await assert.rejects(pending, { code: 'cancelled' })
  assert.equal(closed, 1)
  assert.equal(f.stats().decodedFrames, 0)
})

test('oversized data is rejected before decoder and audio allocation', async () => {
  const f = fixture()
  f.setBytes(new ArrayBuffer(1024 * 1024 + 1))
  await assert.rejects(f.run(), { code: 'resource_exhausted' })
  assert.equal(f.stats().begun, 0)
})

test('unsupported rate, truncated frames and oversized ID3 reject safely', async () => {
  for (const overrides of [
    {
      scan() {
        return { position: 0, length: 4, sampleRate: 44100, channels: 1 }
      },
    },
    {
      scan() {
        return { position: 0, length: 20, sampleRate: 24000, channels: 1 }
      },
    },
    {
      id3Size() {
        return 65537
      },
    },
  ]) {
    const f = fixture(overrides)
    await assert.rejects(f.run(), { code: 'provider_failed' })
    assert.equal(f.stats().finished, 0)
  }
})

test('abort during download does not open playback', async () => {
  const f = fixture()
  f.controller.abort()
  await assert.rejects(f.run(), { code: 'cancelled' })
  assert.equal(f.stats().begun, 0)
})

test('playback state spans actual output and closes on success or decoding failure', async () => {
  const events = [], f = fixture()
  await f.run({ onPlaybackState: value => events.push(value) })
  assert.deepEqual(events,[true,false])
  const failed = fixture({ scan() { return undefined } }), failedEvents = []
  await assert.rejects(failed.run({ onPlaybackState: value => failedEvents.push(value) }))
  assert.deepEqual(failedEvents,[true,false])
})

test('cancelling a blocked PCM write closes the mouth immediately', async () => {
  const block = deferred(), events = []
  const f = fixture({ createPcmSource() { return { output:{}, push:()=>block.promise, end() {} } } })
  const task = f.run({ onPlaybackState:value=>events.push(value) })
  await tick()
  assert.deepEqual(events,[true])
  f.controller.abort()
  assert.deepEqual(events,[true,false])
  await assert.rejects(task)
})
