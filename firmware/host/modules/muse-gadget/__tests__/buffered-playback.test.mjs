import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { setImmediate } from 'node:timers/promises'
import { createBufferedPlayback } from '../playback/buffered-playback.js'

const sources = {
  'muse-buffered-playback': '../playback/buffered-playback.js',
  'stackchan/voice/buffered-pcm-output': '../playback/device-output.js',
  'muse-resampled-output': '../playback/resampled-output.js',
  'pcm-resampler': '../../testing/fakes/pcm-resampler.ts',
  'gemini-worker-events': '../../voice/gemini-worker-events.js',
  timer: '../../testing/fakes/timer.ts',
}
const stubs = {
  'muse-buffered-pcm-page': 'export default class { constructor() { return globalThis.playbackTest.allocatePage() } }',
  'muse-stopwatch-output':
    'export const minimumOutputBytes = 4092; export const openOutput = (...args) => globalThis.playbackTest.openOutput(...args)',
  time: 'export default { ticks: 0 }',
}
registerHooks({
  resolve(specifier, context, next) {
    if (stubs[specifier]) return next(`data:text/javascript,${encodeURIComponent(stubs[specifier])}`, context)
    if (sources[specifier]) return next(new URL(sources[specifier], import.meta.url).href, context)
    if (specifier.startsWith('stackchan/voice/'))
      return next(new URL(`../../voice/${specifier.slice(16)}.ts`, import.meta.url).href, context)
    return next(specifier, context)
  },
})
const { openBufferedOutput: openOutput } = await import('../playback/stopwatch-output.js')
const { createCascadedConversation, createPushToTalk } = await import('../../voice/cascaded.ts')
const { createPcmSink, createPcmSource, mono, pcmMedia } = await import('../../voice/media.ts')
const { createGeminiWorkerTTS } = await import('../../voice/gemini-worker-session.js')
const { synthesize } = await import('../../voice/gemini-worker-request.js')

ArrayBuffer.fromString ??= (value) => new TextEncoder().encode(value).buffer
String.fromArrayBuffer ??= (buffer, offset, length) => new TextDecoder().decode(new Uint8Array(buffer, offset, length))
Uint8Array.fromBase64 ??= (value) => Uint8Array.from(Buffer.from(value, 'base64'))

const packet = (event) => new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)

function playbackHarness() {
  const pages = new Set()
  const opens = []
  const writes = []
  let closes = 0
  return {
    pages,
    opens,
    writes,
    closes: () => closes,
    allocatePage() {
      const data = new Uint8Array(16 * 1024)
      pages.add(data)
      return {
        put(buffer, offset, at, size) {
          assert.ok(pages.has(data))
          data.set(buffer.subarray(offset, offset + size), at)
        },
        get(buffer, offset, at, size) {
          assert.ok(pages.has(data))
          buffer.set(data.subarray(at, at + size), offset)
        },
        close() {
          assert.ok(pages.delete(data))
          data.fill(0)
        },
      }
    },
    openOutput(rate, volume) {
      opens.push({ rate, volume })
      return {
        write(bytes) {
          writes.push(bytes.slice())
        },
        drain() {},
        close() {
          closes++
        },
      }
    },
  }
}

test('buffered replies wait for every Gemini request and play exact joined PCM at most once', async () => {
  const chunks = [`${'あ'.repeat(239)}。`, '続き']
  const cases = [
    { mode: 'bounded' },
    { mode: 'buffered' },
    { mode: 'buffered', failJob: 1, truncate: true },
    { mode: 'buffered', failJob: 2, truncate: true },
    { mode: 'buffered', failJob: 2, truncate: false },
  ]
  for (const { mode, failJob, truncate } of cases) {
    const harness = playbackHarness()
    globalThis.playbackTest = harness
    const supplied = Promise.withResolvers()
    const eof = Promise.withResolvers()
    const requests = []
    const terminal = packet({ event_type: 'interaction.completed', interaction: { status: 'completed' } })
    const tts = createGeminiWorkerTTS({}, (job) => {
      const index = requests.push(job.text)
      const pcm = new Int16Array(9000).fill(index === 1 ? 100 : -100)
      const speech = packet({
        event_type: 'step.delta',
        delta: {
          type: 'audio',
          mime_type: 'audio/l16;rate=24000;channels=1',
          data: Buffer.from(pcm.buffer).toString('base64'),
        },
      })
      return synthesize(async (_body, feed) => {
        await feed(speech)
        if (index !== failJob || truncate) await feed(terminal)
        if (index === (failJob ?? 2)) {
          supplied.resolve()
          await eof.promise
        }
        if (index === failJob && truncate) throw new Error('truncated response')
      }, job)
    })
    const reply = {
      type: 'message',
      role: 'assistant',
      id: 'reply',
      content: [{ type: 'output_text', text: chunks.join('') }],
    }
    const conversation = createCascadedConversation(
      {
        turnDetector: createPushToTalk().detector,
        stt: { open: () => assert.fail('text submission must not start STT') },
        tts,
        agent: {
          async run() {
            return { status: 'completed', response: { output: [reply] }, appended: [reply] }
          },
        },
      },
      mode,
    )
    const signal = new AbortController().signal
    const audio = mono(24000)
    const played = []
    let player
    const output = {
      format: audio,
      budget: { maxBufferedMs: 500, maxBufferedBytes: 24576 },
      begin() {
        player = openOutput(24000, 0.25, 24576, undefined, 3)
        return createPcmSink(audio, (bytes) => player.write(bytes))
      },
      async finish(outputId) {
        await player.drain()
        player.close()
        return { outputId, generation: 0, state: 'played', position: { basis: 'unknown' } }
      },
      async fence() {
        player?.close()
        return []
      },
    }
    const session = await conversation.open({
      signal,
      media: { input: createPcmSource(mono(16000)).output, output, media: pcmMedia },
      history: [],
      onEvent(event) {
        if (event.type === 'output.playback' && event.receipt.state === 'played') played.push(event.receipt.outputId)
      },
    })
    const turn = await session.submit(
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'request' }] },
      { signal },
    )
    await Promise.race([supplied.promise, turn.done.then(() => assert.fail('turn ended before transport EOF'))])
    assert.equal(harness.opens.length, mode === 'bounded' ? 1 : 0)
    assert.deepEqual(requests, chunks.slice(0, failJob ?? 2))
    assert.equal(player.frames, 0)
    player.setVolume(0.5)
    eof.resolve()

    assert.equal((await turn.done).status, failJob ? 'failed' : 'completed')
    if (failJob) {
      assert.equal(harness.opens.length, 0)
      assert.deepEqual(harness.writes, [])
      assert.deepEqual(played, [])
    } else {
      const expectedOpens = [{ rate: 16000, volume: 0.5 }]
      if (mode === 'bounded') expectedOpens.unshift({ rate: 16000, volume: 0.25 })
      assert.deepEqual(harness.opens, expectedOpens)
      assert.deepEqual(played, mode === 'bounded' ? ['reply/0', 'reply/1'] : ['reply/0'])
      const heard = harness.writes.flatMap((bytes) => [...new Int16Array(bytes.buffer)])
      assert.equal(heard.length, 12000)
      assert.ok(heard.every((sample, index) => sample === (index < 6000 ? 100 : -100)))
      assert.equal(harness.closes(), expectedOpens.length)
      assert.equal(player.frames, mode === 'bounded' ? 9000 : 18000)
    }
    assert.equal(harness.pages.size, 0)
    await session.close({ mode: 'abort' })
  }
})

test('the PCM cap releases pages and opens no speaker on overflow or allocation failure', () => {
  for (const overflow of [true, false]) {
    const harness = playbackHarness()
    const playback = createBufferedPlayback({
      allocatePage() {
        if (!overflow && harness.pages.size) throw new Error('allocation failed')
        return harness.allocatePage()
      },
      openOutput: () => assert.fail('incomplete audio must not play'),
      volume: 1,
    })
    if (overflow) playback.write(new Uint8Array(4 * 1024 * 1024))
    assert.throws(() => playback.write(new Uint8Array(32 * 1024)), { code: 'resource_exhausted' })
    assert.equal(harness.pages.size, 0)
    playback.close()
  }
})

test('cancelling playback closes native output once and releases queued pages', async () => {
  const harness = playbackHarness()
  const started = Promise.withResolvers()
  const write = Promise.withResolvers()
  const playback = createBufferedPlayback({
    allocatePage: harness.allocatePage,
    openOutput() {
      return {
        write() {
          started.resolve()
          return write.promise
        },
        drain: () => assert.fail('cancelled output must not drain'),
        close() {
          harness.openOutput().close()
          write.reject(Object.assign(new Error(), { code: 'cancelled' }))
        },
      }
    },
    volume: 1,
  })
  playback.write(new Uint8Array(32 * 1024))
  const draining = playback.drain()
  assert.equal(playback.drain(), draining)
  await started.promise
  playback.close()
  playback.close()
  await assert.rejects(draining, { code: 'cancelled' })
  assert.equal(harness.closes(), 1)
  assert.equal(harness.pages.size, 0)
})

test('streaming waits for a producer write after arming and for the configured lead', async () => {
  for (const alreadyHasLead of [true, false]) {
    const harness = playbackHarness()
    const playback = createBufferedPlayback({
      allocatePage: harness.allocatePage,
      openOutput: (volume) => harness.openOutput(16000, volume),
      streamingLeadBytes: 6,
      volume: 0.25,
    })
    playback.write(new Uint8Array(alreadyHasLead ? 6 : 2))
    playback.allowStreaming()
    if (!alreadyHasLead) playback.write(new Uint8Array(2))
    await setImmediate()
    assert.deepEqual(harness.opens, [])

    playback.setVolume(0.5)
    playback.write(new Uint8Array(2))
    assert.deepEqual(harness.opens, [])
    await setImmediate()
    assert.deepEqual(harness.opens, [{ rate: 16000, volume: 0.5 }])
    await playback.drain()
    playback.close()
  }
})

test('one streaming output plays writes in order while busy and after catching up to the producer', async () => {
  const harness = playbackHarness()
  const writing = Promise.withResolvers()
  const continueWriting = Promise.withResolvers()
  let drains = 0
  const playback = createBufferedPlayback({
    allocatePage: harness.allocatePage,
    openOutput(volume) {
      const output = harness.openOutput(16000, volume)
      return {
        ...output,
        write(bytes) {
          output.write(bytes)
          if (harness.writes.length === 1) {
            writing.resolve()
            return continueWriting.promise
          }
        },
        drain: () => drains++,
      }
    },
    streamingLeadBytes: 4,
    volume: 1,
  })
  const first = Uint8Array.of(5, 4, 3, 2)
  const second = Uint8Array.from({ length: 16400 }, (_, index) => index % 251)
  const third = Uint8Array.of(9, 14, 5, 11)
  playback.allowStreaming()
  playback.write(first)
  await writing.promise
  playback.write(second)
  continueWriting.resolve()
  await setImmediate()
  assert.deepEqual(Buffer.concat(harness.writes), Buffer.concat([first, second]))
  assert.equal(drains, 0)

  playback.write(third)
  await setImmediate()
  assert.deepEqual(Buffer.concat(harness.writes), Buffer.concat([first, second, third]))
  assert.equal(drains, 0)
  const draining = playback.drain()
  assert.equal(playback.drain(), draining)
  await draining
  assert.equal(drains, 1)
  assert.equal(harness.opens.length, 1)
  assert.equal(playback.submittedFrames, (first.length + second.length + third.length) / 2)
  playback.close()
  assert.equal(harness.pages.size, 0)
})

test('closing a streaming output waiting for data wakes playback and rejects further writes', async () => {
  const harness = playbackHarness()
  const playback = createBufferedPlayback({
    allocatePage: harness.allocatePage,
    openOutput: (volume) => harness.openOutput(16000, volume),
    streamingLeadBytes: 4,
    volume: 1,
  })
  playback.allowStreaming()
  playback.write(Uint8Array.of(1, 2, 3, 4))
  await setImmediate()
  assert.equal(playback.submittedFrames, 2)
  playback.close()
  playback.close()
  assert.throws(() => playback.write(Uint8Array.of(5, 6)), { code: 'cancelled' })
  await assert.rejects(playback.drain(), { code: 'cancelled' })
  assert.equal(harness.closes(), 1)
  assert.equal(harness.pages.size, 0)
})

test('an early open failure defers the complete PCM to drain', async () => {
  const harness = playbackHarness()
  let attempts = 0
  const playback = createBufferedPlayback({
    allocatePage: harness.allocatePage,
    openOutput(volume) {
      if (++attempts === 1) throw new Error('driver unavailable during synthesis')
      return harness.openOutput(16000, volume)
    },
    streamingLeadBytes: 4,
    volume: 1,
  })
  const first = Uint8Array.of(1, 2, 3, 4)
  const second = Uint8Array.of(5, 6)
  playback.allowStreaming()
  playback.write(first)
  await setImmediate()
  assert.equal(attempts, 1)
  playback.allowStreaming()
  playback.write(second)
  await setImmediate()
  assert.equal(attempts, 1)
  assert.deepEqual(harness.writes, [])

  await playback.drain()
  assert.equal(attempts, 2)
  assert.deepEqual(Buffer.concat(harness.writes), Buffer.concat([first, second]))
  assert.equal(playback.submittedFrames, 3)
  playback.close()
  assert.equal(harness.pages.size, 0)
})

test('a downstream write failure is reported without reopening the streaming output', async () => {
  const harness = playbackHarness()
  const failure = new Error('driver write failed')
  const playback = createBufferedPlayback({
    allocatePage: harness.allocatePage,
    openOutput(volume) {
      return {
        ...harness.openOutput(16000, volume),
        write() {
          throw failure
        },
      }
    },
    streamingLeadBytes: 4,
    volume: 1,
  })
  playback.allowStreaming()
  playback.write(Uint8Array.of(1, 2, 3, 4))
  await setImmediate()
  assert.throws(() => playback.write(Uint8Array.of(5, 6)), failure)
  await assert.rejects(playback.drain(), failure)
  assert.equal(harness.opens.length, 1)
  playback.close()
  assert.equal(harness.pages.size, 0)
})
