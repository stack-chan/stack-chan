import assert from 'node:assert/strict'
import test from 'node:test'
import { installUsbAudioTestAliases } from './__tests__/node-aliases.js'

installUsbAudioTestAliases()

const { SharedByteRing } = await import('../audio/platforms/m5stackchan-cores3/shared-byte-ring.js')
const { resetSharedSpeakerOutputState, SharedSpeakerOutputService, SPEAKER_STATS_WORDS } = await import(
  './shared-speaker-output.js'
)

test('shared speaker output waits for main-thread open acknowledgement before reusing the ring', () => {
  const ring = SharedByteRing.allocate(16)
  const stats = new Int32Array(new SharedArrayBuffer(SPEAKER_STATS_WORDS * Int32Array.BYTES_PER_ELEMENT))
  Atomics.store(ring.state, 0, 3)
  Atomics.store(ring.state, 1, 5)
  Atomics.store(stats, 0, 99)
  const messages: Array<Record<string, unknown>> = []
  const writable: number[] = []
  const service = new SharedSpeakerOutputService(
    { ring: ring.buffers, stats: stats.buffer as SharedArrayBuffer },
    (message) => messages.push(message),
  )
  const output = service.createOutput({
    streamId: 7,
    sampleRate: 24000,
    channels: 1,
    bitsPerSample: 16,
    onWritable(size) {
      writable.push(size)
    },
    onDrained() {},
    onError() {},
  })

  output.start()
  output.poll()

  assert.deepEqual(Array.from(ring.state), [3, 5])
  assert.equal(Atomics.load(stats, 0), 99)
  assert.deepEqual(writable, [])
  assert.deepEqual(
    messages.map((message) => message.id),
    ['audio-open'],
  )

  service.handleOpened(6)
  output.poll()
  assert.deepEqual(writable, [])

  resetSharedSpeakerOutputState(ring, stats)
  service.handleOpened(7)
  output.poll()

  assert.deepEqual(Array.from(ring.state), [0, 0])
  assert.equal(Atomics.load(stats, 0), 0)
  assert.deepEqual(writable, [14])
})
